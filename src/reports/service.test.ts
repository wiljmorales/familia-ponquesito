import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateWeeklyReportDeps } from "./service";

// service.ts (y sus dependencias) importan "server-only"; en Vitest no hay
// bundler que distinga cliente/servidor, así que se neutraliza aquí.
vi.mock("server-only", () => ({}));

import type { EmailClient, SendEmailInput, SendEmailResult } from "@/email/client";
import { generateWeeklyReport, maskEmail } from "./service";
import type { WeeklyReportMetrics } from "./types";

/** Lunes 2026-07-13, 12:00 UTC = 8:00 a. m. en Caracas (hora real del cron). */
const NOW = new Date("2026-07-13T12:00:00Z");

interface FakeRow {
  [key: string]: unknown;
}

type Filter = [op: "eq" | "gte" | "lte" | "lt", field: string, value: unknown];

/**
 * Fake mínimo de Supabase para los patrones del servicio del reporte:
 * insert().select().single() con el índice único parcial de weekly_reports,
 * update().eq() y select() con filtros gte/lte/lt y count/head. Proyecta
 * las columnas pedidas a propósito: las filas sembradas incluyen datos
 * personales y las pruebas verifican que el servicio nunca los selecciona.
 */
class FakeReportsDb {
  tables: Record<string, FakeRow[]> = {
    leads: [],
    lead_automation_events: [],
    weekly_reports: [],
  };
  failSelects = new Set<string>();
  selectQueries: Array<{ table: string; filters: Filter[]; head: boolean }> = [];
  private nextId = 1;

  client(): NonNullable<GenerateWeeklyReportDeps["post"]> {
    return (async (operation: string, payload: Record<string, unknown> | FormData) => {
      const p = payload as Record<string, unknown>;
      if (operation === "report-reserve") {
        const result = this.insertRow("weekly_reports", { ...p, status: "processing" });
        return result.error ? { ok: false, error: "duplicate" } : { ok: true, id: result.data?.id };
      }
      if (operation === "report-update") {
        const row = this.tables.weekly_reports.find(item => item.id === p.id);
        if (row) Object.assign(row, p);
        return { ok: Boolean(row) };
      }
      if (operation === "report-data") {
        const periodFilters: Filter[] = [["gte", "created_at", p.start_utc], ["lt", "created_at", p.end_exclusive_utc]];
        const upcomingFilters: Filter[] = [["gte", "celebration_date", p.upcoming_from], ["lte", "celebration_date", p.upcoming_to]];
        this.selectQueries.push({ table: "leads", filters: periodFilters, head: false });
        this.selectQueries.push({ table: "leads", filters: [], head: true });
        this.selectQueries.push({ table: "leads", filters: upcomingFilters, head: true });
        this.selectQueries.push({ table: "lead_automation_events", filters: periodFilters, head: false });
        if (this.failSelects.has("leads")) return { ok: false };
        const project = (row: FakeRow, fields: string[]) => Object.fromEntries(fields.map(field => [field, row[field]]));
        const inPeriod = (row: FakeRow) => String(row.created_at) >= String(p.start_utc) && String(row.created_at) < String(p.end_exclusive_utc);
        return {
          ok: true,
          leads_in_period: this.tables.leads.filter(inPeriod).map(row => project(row, ["id", "source_type", "celebration_date", "priority", "created_at"])),
          total_leads: this.tables.leads.length,
          upcoming_celebrations: this.tables.leads.filter(row => String(row.celebration_date) >= String(p.upcoming_from) && String(row.celebration_date) <= String(p.upcoming_to)).length,
          events_in_period: this.tables.lead_automation_events.filter(inPeriod).map(row => project(row, ["lead_id", "event_type", "status", "created_at"])),
        };
      }
      throw new Error(`Unexpected test operation: ${operation}`);
    }) as NonNullable<GenerateWeeklyReportDeps["post"]>;
  }

  insertRow(table: string, row: Record<string, unknown>) {
    if (table === "weekly_reports" && row.trigger_type === "scheduled") {
      const clashes = this.tables[table].some(
        (existing) =>
          existing.trigger_type === "scheduled" &&
          existing.period_start === row.period_start &&
          existing.period_end === row.period_end,
      );
      if (clashes) {
        return {
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "weekly_reports_scheduled_period_key"',
          },
        };
      }
    }

    const stored: FakeRow = { id: `row-${this.nextId++}`, ...row };
    this.tables[table].push(stored);
    return { data: stored, error: null };
  }
}

function seedLead(db: FakeReportsDb, overrides: Partial<FakeRow> = {}) {
  db.tables.leads.push({
    id: `lead-${db.tables.leads.length + 1}`,
    source_type: "cake_request",
    celebration_date: "2026-07-25",
    priority: "normal",
    created_at: "2026-07-07T10:00:00.000Z",
    // Datos personales sembrados a propósito: el servicio NUNCA debe
    // seleccionarlos (privacidad desde la consulta).
    customer_name: "Ana Pérez",
    customer_email: "ana@example.com",
    customer_whatsapp: "+584141234567",
    normalized_payload: { celebrationType: "cumpleanos" },
    ...overrides,
  });
}

function seedEvent(db: FakeReportsDb, overrides: Partial<FakeRow> = {}) {
  db.tables.lead_automation_events.push({
    lead_id: "lead-1",
    event_type: "customer_email",
    status: "success",
    created_at: "2026-07-07T10:00:05.000Z",
    error_message: "detalle interno que el reporte no necesita",
    metadata: { providerId: "gmail-123" },
    ...overrides,
  });
}

function createFakeEmailClient(results: SendEmailResult[] = []) {
  const send = vi.fn<(input: SendEmailInput) => Promise<SendEmailResult>>();
  for (const result of results) send.mockResolvedValueOnce(result);
  send.mockResolvedValue({ ok: true, providerId: "gmail-ok" });
  return { client: { send } as unknown as EmailClient, send };
}

function fakeSummaryGenerator() {
  return vi
    .fn<(metrics: WeeklyReportMetrics) => Promise<{ summary: string; source: "gemini" }>>()
    .mockResolvedValue({ summary: "Resumen inyectado.", source: "gemini" });
}

function reportRow(db: FakeReportsDb, index = 0): FakeRow {
  return db.tables.weekly_reports[index];
}

describe("maskEmail", () => {
  it("conserva solo la primera letra y el dominio", () => {
    expect(maskEmail("karem@gmail.com")).toBe("k•••@gmail.com");
    expect(maskEmail("sin-arroba")).toBe("•••");
  });
});

describe("generateWeeklyReport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("genera, envía y registra el reporte completo del periodo", async () => {
    const db = new FakeReportsDb();
    seedLead(db, { id: "lead-1", source_type: "cake_request", priority: "urgent" });
    seedLead(db, { id: "lead-2", source_type: "cake_request", priority: "high" });
    seedLead(db, { id: "lead-3", source_type: "cake_design", priority: "normal" });
    seedEvent(db, { lead_id: "lead-1", event_type: "lead_registered" });
    seedEvent(db, { lead_id: "lead-1", event_type: "customer_email", status: "error" });
    seedEvent(db, { lead_id: "lead-1", event_type: "customer_email", status: "success" });
    seedEvent(db, { lead_id: "lead-1", event_type: "owner_email", status: "success" });

    const { client, send } = createFakeEmailClient([{ ok: true, providerId: "gmail-1" }]);
    const summaryGenerator = fakeSummaryGenerator();

    const result = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator,
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(result.outcome).toBe("sent");
    expect(result.period).toEqual({ start: "2026-07-06", end: "2026-07-12" });

    expect(send).toHaveBeenCalledTimes(1);
    const sentMessage = send.mock.calls[0][0] as { to: string; subject: string };
    expect(sentMessage.to).toBe("karem@example.com");
    expect(sentMessage.subject).toContain("Pulso Ponquesito");

    const row = reportRow(db);
    expect(row.status).toBe("sent");
    expect(row.trigger_type).toBe("scheduled");
    expect(row.summary).toBe("Resumen inyectado.");
    expect(row.summary_source).toBe("gemini");
    expect(row.recipient_masked).toBe("k•••@example.com");
    expect(row.sent_at).toBeTruthy();
    expect(row.error_message).toBeNull();

    const metrics = row.metrics as WeeklyReportMetrics;
    expect(metrics.leads.newInPeriod).toBe(3);
    expect(metrics.leads.bySource).toEqual({
      cake_request: 2,
      cake_design: 1,
      agent_message: 0,
      cake_reservation: 0,
    });
    expect(metrics.leads.byPriority).toEqual({ not_viable: 0, urgent: 1, high: 1, normal: 1 });
    // error + success del mismo correo = UN envío exitoso.
    expect(metrics.automation.emails).toEqual({
      attempted: 2,
      sent: 2,
      failed: 0,
      sendSuccessRate: 1,
    });
    expect(metrics.automation.eventsInPeriod).toEqual({ success: 3, error: 1 });
  });

  it("el generador de resumen recibe exclusivamente métricas agregadas, sin datos personales", async () => {
    const db = new FakeReportsDb();
    seedLead(db, { id: "lead-1" });
    const { client } = createFakeEmailClient();
    const summaryGenerator = fakeSummaryGenerator();

    await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator,
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(summaryGenerator).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(summaryGenerator.mock.calls[0][0]);
    expect(serialized).not.toMatch(/Ana|ana@example\.com|584141234567|customer|payload/);
  });

  it("cuenta celebraciones próximas de leads antiguos, fuera del periodo semanal", async () => {
    const db = new FakeReportsDb();
    // Lead registrado hace meses, con celebración dentro de los próximos 7 días.
    seedLead(db, {
      id: "lead-old",
      created_at: "2026-05-01T10:00:00.000Z",
      celebration_date: "2026-07-15",
    });

    const { client } = createFakeEmailClient();

    await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    const metrics = reportRow(db).metrics as WeeklyReportMetrics;
    expect(metrics.leads.newInPeriod).toBe(0);
    expect(metrics.upcomingCelebrations.next7Days).toBe(1);

    // La consulta de celebraciones filtra por celebration_date (hoy → +7
    // días en Caracas) y NO por fecha de registro.
    const upcomingQuery = db.selectQueries.find((query) =>
      query.filters.some(([, field]) => field === "celebration_date"),
    );
    expect(upcomingQuery).toBeDefined();
    expect(upcomingQuery!.filters).toEqual([
      ["gte", "celebration_date", "2026-07-13"],
      ["lte", "celebration_date", "2026-07-20"],
    ]);
  });

  it("una semana sin actividad igualmente genera y envía un reporte válido", async () => {
    const db = new FakeReportsDb();
    const { client, send } = createFakeEmailClient();

    const result = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(result.outcome).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const metrics = reportRow(db).metrics as WeeklyReportMetrics;
    expect(metrics.leads.newInPeriod).toBe(0);
    expect(metrics.automation.emails.sendSuccessRate).toBeNull();
  });

  it("un fallo de SMTP (con su reintento) queda registrado como email_error, sin perder métricas ni resumen", async () => {
    const db = new FakeReportsDb();
    seedLead(db, { id: "lead-1" });
    const { client, send } = createFakeEmailClient([
      { ok: false, error: "smtp caído" },
      { ok: false, error: "smtp caído" },
    ]);

    const result = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(result.outcome).toBe("email_error");
    expect(send).toHaveBeenCalledTimes(2); // intento + reintento

    const row = reportRow(db);
    expect(row.status).toBe("email_error");
    expect(row.error_message).toBe("smtp caído");
    expect(row.sent_at).toBeNull();
    expect(row.metrics).toBeTruthy();
    expect(row.summary).toBe("Resumen inyectado.");
  });

  it("un error de consulta marca la fila como data_error y no envía correo", async () => {
    const db = new FakeReportsDb();
    db.failSelects.add("leads");
    const { client, send } = createFakeEmailClient();

    const result = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(result.outcome).toBe("data_error");
    expect(result.error).toContain("datos del reporte");
    expect(send).not.toHaveBeenCalled();

    const row = reportRow(db);
    expect(row.status).toBe("data_error");
    expect(row.error_message).toContain("datos del reporte");
  });

  it("una segunda corrida programada del mismo periodo se omite sin enviar correo (reserva por índice único)", async () => {
    const db = new FakeReportsDb();
    const { client, send } = createFakeEmailClient();

    const first = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });
    const second = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(first.outcome).toBe("sent");
    expect(second.outcome).toBe("skipped_duplicate");
    expect(second.reportId).toBeNull();
    expect(db.tables.weekly_reports).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("las corridas manuales son repetibles: cada una crea su propia fila y envía su correo", async () => {
    const db = new FakeReportsDb();
    const { client, send } = createFakeEmailClient();

    const first = await generateWeeklyReport("manual", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });
    const second = await generateWeeklyReport("manual", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(first.outcome).toBe("sent");
    expect(second.outcome).toBe("sent");
    expect(db.tables.weekly_reports).toHaveLength(2);
    expect(db.tables.weekly_reports.every((row) => row.status === "sent")).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sin KAREM_NOTIFICATION_EMAIL registra email_error sin llamar al proveedor, conservando métricas y resumen", async () => {
    const db = new FakeReportsDb();
    const { client, send } = createFakeEmailClient();

    // Sin override, el servicio caería a process.env; se borra para que la
    // prueba no dependa del entorno real.
    const originalEnvValue = process.env.KAREM_NOTIFICATION_EMAIL;
    delete process.env.KAREM_NOTIFICATION_EMAIL;

    const result = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      now: NOW,
    });

    if (originalEnvValue !== undefined) process.env.KAREM_NOTIFICATION_EMAIL = originalEnvValue;

    expect(result.outcome).toBe("email_error");
    expect(result.error).toContain("KAREM_NOTIFICATION_EMAIL");
    expect(send).not.toHaveBeenCalled();

    const row = reportRow(db);
    expect(row.status).toBe("email_error");
    expect(row.metrics).toBeTruthy();
    expect(row.summary).toBe("Resumen inyectado.");
    expect(row.recipient_masked).toBeUndefined();
  });

  it("un generador de resumen que lanza no detiene el reporte: cae al fallback determinístico y se envía igual", async () => {
    const db = new FakeReportsDb();
    seedLead(db, { id: "lead-1" });
    const { client, send } = createFakeEmailClient();
    const throwingGenerator = vi.fn(async () => {
      throw new Error("Gemini explotó");
    });

    const result = await generateWeeklyReport("scheduled", {
      post: db.client(),
      emailClient: client,
      summaryGenerator: throwingGenerator,
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(result.outcome).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);

    const row = reportRow(db);
    expect(row.status).toBe("sent");
    expect(row.summary_source).toBe("fallback");
    expect(typeof row.summary).toBe("string");
    expect((row.summary as string).length).toBeGreaterThan(0);
  });
});

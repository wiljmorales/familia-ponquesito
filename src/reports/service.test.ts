import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

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

  client(): SupabaseClient {
    return {
      from: (table: string) => new FakeQueryBuilder(this, table),
    } as unknown as SupabaseClient;
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

class FakeQueryBuilder {
  private mode: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private head = false;
  private columns?: string;
  private insertResult?: { data: FakeRow | null; error: { code: string; message: string } | null };
  private updateValues?: Record<string, unknown>;

  constructor(
    private readonly db: FakeReportsDb,
    private readonly table: string,
  ) {}

  insert(row: Record<string, unknown>) {
    this.mode = "insert";
    this.insertResult = this.db.insertRow(this.table, row);
    return this;
  }

  update(values: Record<string, unknown>) {
    this.mode = "update";
    this.updateValues = values;
    return this;
  }

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.mode === "select") {
      this.columns = columns;
      this.head = options?.head ?? false;
    }
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push(["eq", field, value]);
    return this;
  }

  gte(field: string, value: unknown) {
    this.filters.push(["gte", field, value]);
    return this;
  }

  lte(field: string, value: unknown) {
    this.filters.push(["lte", field, value]);
    return this;
  }

  lt(field: string, value: unknown) {
    this.filters.push(["lt", field, value]);
    return this;
  }

  private matches(): FakeRow[] {
    return this.db.tables[this.table].filter((row) =>
      this.filters.every(([op, field, value]) => {
        const actual = row[field] as string;
        const expected = value as string;
        if (op === "eq") return actual === expected;
        if (op === "gte") return actual >= expected;
        if (op === "lte") return actual <= expected;
        return actual < expected;
      }),
    );
  }

  private project(rows: FakeRow[]): FakeRow[] {
    if (!this.columns || this.columns === "*") return rows;
    const picked = this.columns.split(",").map((column) => column.trim());
    return rows.map((row) =>
      Object.fromEntries(picked.map((column) => [column, row[column]])),
    );
  }

  private resolve(): { data: unknown; error: unknown; count: number | null } {
    if (this.mode === "insert") {
      return { ...this.insertResult!, count: null };
    }
    if (this.mode === "update") {
      for (const row of this.matches()) Object.assign(row, this.updateValues);
      return { data: null, error: null, count: null };
    }

    this.db.selectQueries.push({ table: this.table, filters: this.filters, head: this.head });
    if (this.db.failSelects.has(this.table)) {
      return { data: null, error: { message: "fallo simulado de la consulta" }, count: null };
    }
    const rows = this.matches();
    return { data: this.head ? null : this.project(rows), error: null, count: rows.length };
  }

  async single() {
    if (this.mode === "insert") return this.insertResult!;
    const result = this.resolve();
    const rows = (result.data as FakeRow[] | null) ?? [];
    return { data: rows[0] ?? null, error: result.error };
  }

  then(onfulfilled?: ((value: { data: unknown; error: unknown; count: number | null }) => unknown) | null) {
    return Promise.resolve(this.resolve()).then(onfulfilled ?? undefined);
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
      supabase: db.client(),
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
      supabase: db.client(),
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
      supabase: db.client(),
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
      supabase: db.client(),
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
      supabase: db.client(),
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
      supabase: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });

    expect(result.outcome).toBe("data_error");
    expect(result.error).toContain("leads del periodo");
    expect(send).not.toHaveBeenCalled();

    const row = reportRow(db);
    expect(row.status).toBe("data_error");
    expect(row.error_message).toContain("leads del periodo");
  });

  it("una segunda corrida programada del mismo periodo se omite sin enviar correo (reserva por índice único)", async () => {
    const db = new FakeReportsDb();
    const { client, send } = createFakeEmailClient();

    const first = await generateWeeklyReport("scheduled", {
      supabase: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });
    const second = await generateWeeklyReport("scheduled", {
      supabase: db.client(),
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
      supabase: db.client(),
      emailClient: client,
      summaryGenerator: fakeSummaryGenerator(),
      karemEmail: "karem@example.com",
      now: NOW,
    });
    const second = await generateWeeklyReport("manual", {
      supabase: db.client(),
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
      supabase: db.client(),
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
      supabase: db.client(),
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

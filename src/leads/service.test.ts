import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// service.ts (y sus dependencias) importan "server-only"; en Vitest no hay
// bundler que distinga cliente/servidor, así que se neutraliza aquí.
vi.mock("server-only", () => ({}));

import { processLead, processReservationLead } from "./service";
import type { EmailClient, SendEmailResult } from "@/email/client";
import type { ProcessLeadInput } from "./types";
import type { ReservationEmailContext } from "@/email/templates/reservation-types";

/**
 * Fake mínimo de Supabase, suficiente para los patrones de consulta que usa
 * service.ts: insert().select().single() e insert() a secas para
 * lead_automation_events, y select().eq()...maybeSingle() para las
 * comprobaciones de idempotencia. Simula las mismas violaciones de unicidad
 * que Postgres (code 23505) para poder probar los caminos de colisión.
 */
interface FakeRow {
  [key: string]: unknown;
}

class FakeTable {
  rows: FakeRow[] = [];
  private nextId = 1;

  constructor(
    private readonly uniqueConstraints: {
      name: string;
      columns: string[];
      whenNotNull?: string;
    }[] = [],
  ) {}

  insert(row: Record<string, unknown>): { data: FakeRow | null; error: { code: string; message: string } | null } {
    for (const constraint of this.uniqueConstraints) {
      if (constraint.whenNotNull && row[constraint.whenNotNull] == null) {
        continue;
      }
      const clashes = this.rows.some((existing) =>
        constraint.columns.every((col) => existing[col] === row[col]),
      );
      if (clashes) {
        return {
          data: null,
          error: {
            code: "23505",
            message: `duplicate key value violates unique constraint "${constraint.name}"`,
          },
        };
      }
    }

    const stored: FakeRow = { id: `row-${this.nextId++}`, ...row };
    this.rows.push(stored);
    return { data: stored, error: null };
  }
}

class FakeQueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private limitCount?: number;
  private insertResult?: { data: FakeRow | null; error: { code: string; message: string } | null };

  constructor(private readonly table: FakeTable) {}

  insert(row: Record<string, unknown>) {
    this.insertResult = this.table.insert(row);
    return this;
  }

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private matches(): FakeRow[] {
    return this.table.rows.filter((row) =>
      this.filters.every(([field, value]) => row[field] === value),
    );
  }

  async single() {
    if (this.insertResult) return this.insertResult;
    const matches = this.matches();
    return { data: matches[0] ?? null, error: null };
  }

  async maybeSingle() {
    if (this.insertResult) return this.insertResult;
    const matches = this.matches();
    const limited = this.limitCount !== undefined ? matches.slice(0, this.limitCount) : matches;
    return { data: limited[0] ?? null, error: null };
  }

  then(onfulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null) {
    const result = this.insertResult ?? { data: this.matches(), error: null };
    return Promise.resolve(onfulfilled ? onfulfilled(result) : result);
  }
}

function createFakeSupabase() {
  const leads = new FakeTable([
    { name: "leads_source_unique", columns: ["source_type", "source_id"] },
    { name: "leads_reference_code_key", columns: ["reference_code"] },
  ]);
  const events = new FakeTable();
  const reservationEvents = new FakeTable([
    {
      name: "reservation_events_dedupe_idx",
      columns: ["reservation_id", "dedupe_key"],
      whenNotNull: "dedupe_key",
    },
  ]);

  const tables: Record<string, FakeTable> = {
    leads,
    lead_automation_events: events,
    reservation_events: reservationEvents,
  };

  const supabase = {
    from(tableName: string) {
      return new FakeQueryBuilder(tables[tableName]);
    },
  };

  return {
    supabase: supabase as unknown as SupabaseClient,
    leads,
    events,
    reservationEvents,
  };
}

function createFakeEmailClient(results: SendEmailResult[]) {
  const send = vi.fn();
  for (const result of results) send.mockResolvedValueOnce(result);
  // Cualquier llamada de más (no esperada por la prueba) también responde ok,
  // para no ensuciar pruebas que no necesitan controlar cada intento.
  send.mockResolvedValue({ ok: true, providerId: "unexpected-call" });
  return { client: { send } as unknown as EmailClient, send };
}

const BASE_INPUT: ProcessLeadInput = {
  source: "cake_request",
  sourceId: "cake-request-1",
  customerName: "Ana Pérez",
  customerWhatsapp: "+584141234567",
  customerEmail: "ana@example.com",
  celebrationDate: "2026-03-01",
  summaryLines: ["Celebración: Cumpleaños"],
  normalizedPayload: { celebrationType: "cumpleanos" },
};

const RESERVATION_INPUT = {
  ...BASE_INPUT,
  source: "cake_reservation" as const,
  sourceId: "reservation-1",
  referenceCode: "FP-8-ABCD",
  celebrationDate: "2026-08-15",
  normalizedPayload: {
    code: "FP-8-ABCD",
    celebrationDate: "2026-08-15",
    status: "pending_deposit",
  },
  reservation: {
    code: "FP-8-ABCD",
    celebrationDate: "2026-08-15",
    status: "pending_deposit" as const,
    capacityPoints: 2 as const,
    classificationReasons: ["Decoración personalizada."],
    guestCount: 20,
    flavorLabel: "Chocolate",
    theme: "Flores",
    designDescription: "Torta floral",
    fulfillmentType: "pickup" as const,
    hasReferenceImage: false,
  },
};

const RESERVATION_EMAIL_CONTEXT: ReservationEmailContext = {
  manageUrl:
    "https://familia-ponquesito.vercel.app/agenda/reservas/FP-8-ABCD?token=token-claro",
  capacity: { total: 4, used: 2, remaining: 2, provisional: false },
};

describe("processLead", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registra el lead y envía ambos correos con éxito", async () => {
    const { supabase, leads, events } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: true, providerId: "customer-email-id" },
      { ok: true, providerId: "owner-email-id" },
    ]);

    await processLead(BASE_INPUT, {
      supabase,
      emailClient: client,
      karemEmail: "karem@example.com",
    });

    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0].reference_code).toMatch(/^FP-2-/);
    expect(send).toHaveBeenCalledTimes(2);

    const eventTypes = events.rows.map((e) => e.event_type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["lead_registered", "customer_email", "owner_email"]),
    );
    expect(events.rows.every((e) => e.status === "success")).toBe(true);

    const ownerEvent = events.rows.find((e) => e.event_type === "owner_email");
    expect((ownerEvent?.metadata as Record<string, unknown>).providerId).toBe("owner-email-id");
  });

  it("es idempotente: correr processLead dos veces no reenvía correos exitosos ni duplica el lead", async () => {
    const { supabase, leads, events } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: true, providerId: "customer-email-id" },
      { ok: true, providerId: "owner-email-id" },
    ]);

    await processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: "karem@example.com" });
    await processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: "karem@example.com" });

    expect(leads.rows).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2); // no 4: la segunda corrida no reenvía nada
    expect(events.rows.filter((e) => e.event_type === "customer_email")).toHaveLength(1);
    expect(events.rows.filter((e) => e.event_type === "owner_email")).toHaveLength(1);
  });

  it("reintenta un envío fallido y, si el reintento falla de nuevo, sí se puede reintentar en la próxima corrida", async () => {
    const { supabase, events } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: false, error: "fallo transitorio" }, // intento 1 del correo al cliente
      { ok: false, error: "fallo transitorio" }, // reintento (dentro del mismo sendWithRetry)
      { ok: true, providerId: "owner-email-id" }, // correo a Karem, primer intento
    ]);

    await processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: "karem@example.com" });

    // 2 intentos para el correo al cliente (falló ambos) + 1 para el de Karem.
    expect(send).toHaveBeenCalledTimes(3);
    const customerEvent = events.rows.find((e) => e.event_type === "customer_email");
    expect(customerEvent?.status).toBe("error");
    expect(customerEvent?.error_message).toBe("fallo transitorio");
    // El correo a Karem se intenta igual aunque el del cliente haya fallado.
    const ownerEvent = events.rows.find((e) => e.event_type === "owner_email");
    expect(ownerEvent?.status).toBe("success");

    // Una segunda corrida SÍ debe reintentar el correo al cliente (no tuvo éxito antes).
    send.mockReset();
    send.mockResolvedValueOnce({ ok: true, providerId: "customer-email-id-2" });
    await processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: "karem@example.com" });
    expect(send).toHaveBeenCalledTimes(1); // solo el correo al cliente; el de Karem ya tuvo éxito
  });

  it("si falla el correo interno, no revierte ni reenvía el correo del cliente ya exitoso", async () => {
    const { supabase, events } = createFakeSupabase();
    const { client } = createFakeEmailClient([
      { ok: true, providerId: "customer-email-id" },
      { ok: false, error: "dominio no verificado" },
      { ok: false, error: "dominio no verificado" },
    ]);

    await processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: "karem@example.com" });

    const customerEvent = events.rows.find((e) => e.event_type === "customer_email");
    const ownerEvent = events.rows.find((e) => e.event_type === "owner_email");
    expect(customerEvent?.status).toBe("success");
    expect(ownerEvent?.status).toBe("error");
  });

  it("nunca simula éxito del correo a Karem si falta el destinatario configurado", async () => {
    const { supabase, events } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([{ ok: true, providerId: "customer-email-id" }]);

    // Sin override de karemEmail, el servicio caería a process.env; se borra
    // explícitamente para que la prueba no dependa de si el proceso de test
    // heredó KAREM_NOTIFICATION_EMAIL del entorno real.
    const originalEnvValue = process.env.KAREM_NOTIFICATION_EMAIL;
    delete process.env.KAREM_NOTIFICATION_EMAIL;

    await processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: undefined });

    if (originalEnvValue !== undefined) process.env.KAREM_NOTIFICATION_EMAIL = originalEnvValue;

    const ownerEvent = events.rows.find((e) => e.event_type === "owner_email");
    expect(ownerEvent?.status).toBe("error");
    expect(ownerEvent?.error_message).toContain("KAREM_NOTIFICATION_EMAIL");
    // Solo el correo al cliente debió intentarse; nunca se llamó a send() para Karem.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("no lanza ni pierde el lead si Supabase falla al registrar el evento de correo", async () => {
    const { supabase } = createFakeSupabase();
    const { client } = createFakeEmailClient([
      { ok: true, providerId: "a" },
      { ok: true, providerId: "b" },
    ]);

    await expect(
      processLead(BASE_INPUT, { supabase, emailClient: client, karemEmail: "karem@example.com" }),
    ).resolves.toBeUndefined();
  });

  it("reutiliza el design_code ya generado para leads del Reto 3 como reference_code", async () => {
    const { supabase, leads } = createFakeSupabase();
    const { client } = createFakeEmailClient([
      { ok: true, providerId: "a" },
      { ok: true, providerId: "b" },
    ]);

    await processLead(
      { ...BASE_INPUT, source: "cake_design", referenceCode: "FP-3-A7K2" },
      { supabase, emailClient: client, karemEmail: "karem@example.com" },
    );

    expect(leads.rows[0].reference_code).toBe("FP-3-A7K2");
  });

  it("reutiliza el código FP-8 real y selecciona las plantillas de reserva", async () => {
    const { supabase, leads } = createFakeSupabase();
    const { client } = createFakeEmailClient([
      { ok: true, providerId: "a" },
      { ok: true, providerId: "b" },
    ]);

    await processReservationLead(
      RESERVATION_INPUT,
      RESERVATION_EMAIL_CONTEXT,
      { supabase, emailClient: client, karemEmail: "karem@example.com" },
    );

    expect(leads.rows[0].reference_code).toBe("FP-8-ABCD");
  });

  it("proyecta eventos terminales idempotentes y no reenvía correos exitosos", async () => {
    const { supabase, reservationEvents } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: true, providerId: "customer-provider" },
      { ok: true, providerId: "owner-provider" },
    ]);
    const options = { supabase, emailClient: client, karemEmail: "karem@example.com" };

    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, options);
    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, options);

    expect(send).toHaveBeenCalledTimes(2);
    expect(reservationEvents.rows.map((row) => row.dedupe_key).sort()).toEqual([
      "customer_email_sent",
      "lead_registered",
      "owner_email_sent",
    ]);
  });

  it("un fallo del cliente no impide el correo interno y puede reintentarse", async () => {
    const { supabase, reservationEvents } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: false, error: "fallo cliente" },
      { ok: false, error: "fallo cliente" },
      { ok: true, providerId: "owner-provider" },
    ]);
    const options = { supabase, emailClient: client, karemEmail: "karem@example.com" };

    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, options);

    expect(send).toHaveBeenCalledTimes(3);
    expect(
      reservationEvents.rows.some(
        (row) =>
          row.event_type === "email_failed" &&
          (row.metadata as Record<string, unknown>).recipient === "customer" &&
          row.dedupe_key == null,
      ),
    ).toBe(true);
    expect(
      reservationEvents.rows.some((row) => row.dedupe_key === "owner_email_sent"),
    ).toBe(true);

    send.mockReset();
    send.mockResolvedValueOnce({ ok: true, providerId: "customer-provider" });
    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, options);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      reservationEvents.rows.some((row) => row.dedupe_key === "customer_email_sent"),
    ).toBe(true);
  });

  it("un fallo del correo interno no revierte ni reenvía el correo del cliente", async () => {
    const { supabase, reservationEvents } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: true, providerId: "customer-provider" },
      { ok: false, error: "fallo owner" },
      { ok: false, error: "fallo owner" },
    ]);
    const options = { supabase, emailClient: client, karemEmail: "karem@example.com" };

    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, options);

    expect(send).toHaveBeenCalledTimes(3);
    expect(
      reservationEvents.rows.some((row) => row.dedupe_key === "customer_email_sent"),
    ).toBe(true);
    expect(
      reservationEvents.rows.some(
        (row) =>
          row.event_type === "email_failed" &&
          (row.metadata as Record<string, unknown>).recipient === "owner",
      ),
    ).toBe(true);

    send.mockReset();
    send.mockResolvedValueOnce({ ok: true, providerId: "owner-provider" });
    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, options);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("el enlace privado existe solo en el correo del cliente y nunca en datos persistidos", async () => {
    const { supabase, leads, events, reservationEvents } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([
      { ok: true, providerId: "customer-provider" },
      { ok: true, providerId: "owner-provider" },
    ]);

    await processReservationLead(RESERVATION_INPUT, RESERVATION_EMAIL_CONTEXT, {
      supabase,
      emailClient: client,
      karemEmail: "karem@example.com",
    });

    expect(JSON.stringify(send.mock.calls[0][0])).toContain(
      RESERVATION_EMAIL_CONTEXT.manageUrl,
    );
    expect(JSON.stringify(send.mock.calls[1][0])).not.toContain(
      RESERVATION_EMAIL_CONTEXT.manageUrl,
    );

    const persisted = JSON.stringify({
      leads: leads.rows,
      automation: events.rows,
      reservationEvents: reservationEvents.rows,
    });
    expect(persisted).not.toContain(RESERVATION_EMAIL_CONTEXT.manageUrl);
    expect(persisted).not.toContain("token-claro");
    expect(persisted).not.toMatch(/manageUrl|manage_token_hash/i);
  });

  it("rechaza defensivamente un normalized_payload que contenga el contexto privado", async () => {
    const { supabase, leads } = createFakeSupabase();
    const { client, send } = createFakeEmailClient([]);

    await processReservationLead(
      {
        ...RESERVATION_INPUT,
        normalizedPayload: { manageUrl: RESERVATION_EMAIL_CONTEXT.manageUrl },
      },
      RESERVATION_EMAIL_CONTEXT,
      { supabase, emailClient: client, karemEmail: "karem@example.com" },
    );

    expect(leads.rows).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});

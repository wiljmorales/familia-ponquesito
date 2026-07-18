import { describe, expect, it } from "vitest";
import { computeWeeklyMetrics, DATA_DISCLAIMER } from "./metrics";
import type { AutomationEventMetricsRow, LeadMetricsRow, ReportPeriod } from "./types";

const PERIOD: ReportPeriod = {
  start: "2026-07-06",
  end: "2026-07-12",
  startUtc: "2026-07-06T04:00:00.000Z",
  endExclusiveUtc: "2026-07-13T04:00:00.000Z",
  timezone: "America/Caracas",
};

function lead(overrides: Partial<LeadMetricsRow> = {}): LeadMetricsRow {
  return {
    id: "lead-1",
    source_type: "cake_request",
    celebration_date: "2026-07-20",
    priority: "normal",
    created_at: "2026-07-07T10:00:00.000Z",
    ...overrides,
  };
}

function event(overrides: Partial<AutomationEventMetricsRow> = {}): AutomationEventMetricsRow {
  return {
    lead_id: "lead-1",
    event_type: "customer_email",
    status: "success",
    created_at: "2026-07-07T10:00:05.000Z",
    ...overrides,
  };
}

describe("computeWeeklyMetrics", () => {
  it("una semana sin actividad produce métricas válidas, tasa null y la alerta de semana vacía", () => {
    const metrics = computeWeeklyMetrics({
      period: PERIOD,
      leadsInPeriod: [],
      totalLeads: 0,
      upcomingCelebrations: 0,
      eventsInPeriod: [],
    });

    expect(metrics.leads.newInPeriod).toBe(0);
    expect(metrics.leads.totalAccumulated).toBe(0);
    expect(metrics.leads.bySource).toEqual({
      cake_request: 0,
      cake_design: 0,
      agent_message: 0,
      cake_reservation: 0,
    });
    expect(metrics.leads.byPriority).toEqual({ not_viable: 0, urgent: 0, high: 0, normal: 0 });
    expect(metrics.automation.emails).toEqual({
      attempted: 0,
      sent: 0,
      failed: 0,
      sendSuccessRate: null,
    });
    expect(metrics.alerts).toContain("Sin solicitudes nuevas esta semana.");
    expect(metrics.dataDisclaimer).toBe(DATA_DISCLAIMER);
  });

  it("cuenta leads por fuente y por prioridad", () => {
    const metrics = computeWeeklyMetrics({
      period: PERIOD,
      leadsInPeriod: [
        lead({ id: "a", source_type: "cake_request", priority: "urgent" }),
        lead({ id: "b", source_type: "cake_request", priority: "high" }),
        lead({ id: "c", source_type: "cake_design", priority: "normal" }),
        lead({ id: "d", source_type: "cake_reservation", priority: "normal" }),
      ],
      totalLeads: 12,
      upcomingCelebrations: 0,
      eventsInPeriod: [],
    });

    expect(metrics.leads.newInPeriod).toBe(4);
    expect(metrics.leads.totalAccumulated).toBe(12);
    expect(metrics.leads.bySource).toEqual({
      cake_request: 2,
      cake_design: 1,
      agent_message: 0,
      cake_reservation: 1,
    });
    expect(metrics.leads.byPriority).toEqual({ not_viable: 0, urgent: 1, high: 1, normal: 2 });
    expect(metrics.alerts).not.toContain("Sin solicitudes nuevas esta semana.");
  });

  it("las celebraciones próximas llegan como conteo aparte (incluye leads antiguos) y generan alerta", () => {
    const metrics = computeWeeklyMetrics({
      period: PERIOD,
      leadsInPeriod: [],
      totalLeads: 5,
      upcomingCelebrations: 2,
      eventsInPeriod: [],
    });

    expect(metrics.upcomingCelebrations.next7Days).toBe(2);
    expect(metrics.alerts).toContain(
      "2 celebraciones caen en los próximos 7 días: priorizar su confirmación.",
    );
  });

  it("deduplica los envíos de correo por lead + tipo: error seguido de éxito cuenta como UN envío exitoso", () => {
    const metrics = computeWeeklyMetrics({
      period: PERIOD,
      leadsInPeriod: [lead()],
      totalLeads: 1,
      upcomingCelebrations: 0,
      eventsInPeriod: [
        event({ status: "error" }),
        event({ status: "success" }),
      ],
    });

    expect(metrics.automation.emails).toEqual({
      attempted: 1,
      sent: 1,
      failed: 0,
      sendSuccessRate: 1,
    });
    // El conteo crudo de eventos sí registra ambos intentos.
    expect(metrics.automation.eventsInPeriod).toEqual({ success: 1, error: 1 });
  });

  it("un envío sin ningún éxito cuenta como fallido y baja la tasa", () => {
    const metrics = computeWeeklyMetrics({
      period: PERIOD,
      leadsInPeriod: [lead({ id: "a" }), lead({ id: "b" })],
      totalLeads: 2,
      upcomingCelebrations: 0,
      eventsInPeriod: [
        event({ lead_id: "a", event_type: "customer_email", status: "success" }),
        event({ lead_id: "a", event_type: "owner_email", status: "success" }),
        event({ lead_id: "b", event_type: "customer_email", status: "error" }),
        event({ lead_id: "b", event_type: "customer_email", status: "error" }),
      ],
    });

    expect(metrics.automation.emails.attempted).toBe(3);
    expect(metrics.automation.emails.sent).toBe(2);
    expect(metrics.automation.emails.failed).toBe(1);
    expect(metrics.automation.emails.sendSuccessRate).toBe(0.667);
    expect(metrics.alerts).toContain(
      "1 envío de correo automático falló esta semana: revisar el registro de automatización y la configuración de correo.",
    );
  });

  it("los eventos lead_registered cuentan en el total de eventos pero no como correos", () => {
    const metrics = computeWeeklyMetrics({
      period: PERIOD,
      leadsInPeriod: [lead()],
      totalLeads: 1,
      upcomingCelebrations: 0,
      eventsInPeriod: [event({ event_type: "lead_registered", status: "success" })],
    });

    expect(metrics.automation.eventsInPeriod).toEqual({ success: 1, error: 0 });
    expect(metrics.automation.emails.attempted).toBe(0);
    expect(metrics.automation.emails.sendSuccessRate).toBeNull();
  });
});

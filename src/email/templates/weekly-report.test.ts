import { describe, expect, it } from "vitest";
import { DATA_DISCLAIMER } from "@/reports/metrics";
import type { WeeklyReportMetrics } from "@/reports/types";
import { buildWeeklyReportEmail } from "./weekly-report";

function metrics(overrides: Partial<WeeklyReportMetrics> = {}): WeeklyReportMetrics {
  return {
    period: { start: "2026-07-06", end: "2026-07-12", timezone: "America/Caracas" },
    leads: {
      newInPeriod: 3,
      totalAccumulated: 12,
      bySource: { cake_request: 2, cake_design: 1 },
      byPriority: { not_viable: 0, urgent: 1, high: 1, normal: 1 },
    },
    upcomingCelebrations: { next7Days: 2 },
    automation: {
      eventsInPeriod: { success: 9, error: 0 },
      emails: { attempted: 6, sent: 6, failed: 0, sendSuccessRate: 1 },
    },
    alerts: ["2 celebraciones caen en los próximos 7 días: priorizar su confirmación."],
    dataDisclaimer: DATA_DISCLAIMER,
    ...overrides,
  };
}

describe("buildWeeklyReportEmail", () => {
  it("el asunto lleva el periodo con fechas generadas por el servidor", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "Buena semana.",
      summarySource: "gemini",
    });

    expect(email.subject).toBe("Pulso Ponquesito — semana del 6 de julio de 2026 al 12 de julio de 2026");
  });

  it("la condición de datos de prueba aparece en HTML y en texto plano", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "Buena semana.",
      summarySource: "gemini",
    });

    expect(email.html).toContain("pruebas funcionales del Platzi Vibe");
    expect(email.text).toContain("pruebas funcionales del Platzi Vibe");
  });

  it("escapa el resumen: la salida de un modelo no es HTML confiable", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: 'Buena semana <script>alert("x")</script>',
      summarySource: "gemini",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("declara el origen del resumen (IA o automático)", () => {
    const withGemini = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "s",
      summarySource: "gemini",
    });
    const withFallback = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "s",
      summarySource: "fallback",
    });

    expect(withGemini.html).toContain("Gemini");
    expect(withFallback.html).toContain("sin IA");
  });

  it("muestra las métricas con la terminología de aceptado por SMTP, nunca entregado o leído", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "s",
      summarySource: "fallback",
    });

    expect(email.text).toContain("Correos automáticos: 6 de 6 aceptados por el servidor de correo");
    expect(email.text).toContain("Tasa de envío: 100 %");
    expect(email.text).not.toMatch(/entregad|leíd/);
  });

  it("una semana sin envíos muestra la tasa como sin envíos, no como 0 %", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics({
        automation: {
          eventsInPeriod: { success: 0, error: 0 },
          emails: { attempted: 0, sent: 0, failed: 0, sendSuccessRate: null },
        },
      }),
      summary: "s",
      summarySource: "fallback",
    });

    expect(email.text).toContain("Tasa de envío: Sin envíos en el periodo");
    expect(email.text).not.toContain("Tasa de envío: 0 %");
  });

  it("lista las alertas y oculta la prioridad no viable cuando está en cero", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "s",
      summarySource: "fallback",
    });

    expect(email.text).toContain("2 celebraciones caen en los próximos 7 días");
    expect(email.text).not.toContain("No viables");
  });

  it("muestra la prioridad no viable solo si tiene conteo (defensa ante datos manipulados)", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics({
        leads: {
          newInPeriod: 1,
          totalAccumulated: 1,
          bySource: { cake_request: 1, cake_design: 0 },
          byPriority: { not_viable: 1, urgent: 0, high: 0, normal: 0 },
        },
      }),
      summary: "s",
      summarySource: "fallback",
    });

    expect(email.text).toContain("No viables: 1");
  });

  it("no incluye ningún dato personal (por construcción, el contrato no los tiene)", () => {
    const email = buildWeeklyReportEmail({
      metrics: metrics(),
      summary: "s",
      summarySource: "fallback",
    });

    expect(email.html).not.toMatch(/customer|whatsapp|@/i);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_DISCLAIMER } from "./metrics";
import {
  buildFallbackSummary,
  buildSummaryPrompt,
  defaultSummaryGenerator,
  parseSummaryOutput,
} from "./summary";
import type { WeeklyReportMetrics } from "./types";

function metrics(overrides: Partial<WeeklyReportMetrics> = {}): WeeklyReportMetrics {
  return {
    period: { start: "2026-07-06", end: "2026-07-12", timezone: "America/Caracas" },
    leads: {
      newInPeriod: 3,
      totalAccumulated: 12,
      bySource: { cake_request: 2, cake_design: 1, agent_message: 0 },
      byPriority: { not_viable: 0, urgent: 1, high: 1, normal: 1 },
    },
    upcomingCelebrations: { next7Days: 2 },
    automation: {
      eventsInPeriod: { success: 9, error: 0 },
      emails: { attempted: 6, sent: 6, failed: 0, sendSuccessRate: 1 },
    },
    alerts: [],
    dataDisclaimer: DATA_DISCLAIMER,
    ...overrides,
  };
}

const EMPTY_WEEK = metrics({
  leads: {
    newInPeriod: 0,
    totalAccumulated: 12,
    bySource: { cake_request: 0, cake_design: 0, agent_message: 0 },
    byPriority: { not_viable: 0, urgent: 0, high: 0, normal: 0 },
  },
  upcomingCelebrations: { next7Days: 0 },
  automation: {
    eventsInPeriod: { success: 0, error: 0 },
    emails: { attempted: 0, sent: 0, failed: 0, sendSuccessRate: null },
  },
});

describe("buildFallbackSummary", () => {
  it("una semana sin actividad produce un resumen válido y honesto", () => {
    const summary = buildFallbackSummary(EMPTY_WEEK);

    expect(summary).toContain("Semana sin solicitudes nuevas.");
    expect(summary).toContain("No hubo envíos de correo automáticos");
    expect(summary).toContain("12 solicitudes");
  });

  it("una semana con actividad refleja los números reales, sin inventar", () => {
    const summary = buildFallbackSummary(metrics());

    expect(summary).toContain("3 solicitudes nuevas");
    expect(summary).toContain("2 del formulario de la landing");
    expect(summary).toContain("1 del juego Crea tu torta");
    expect(summary).toContain("2 celebraciones en los próximos 7 días");
    expect(summary).toContain("6 envíos de correo automáticos del periodo salieron con éxito");
  });

  it("reporta los correos fallidos cuando los hay", () => {
    const summary = buildFallbackSummary(
      metrics({
        automation: {
          eventsInPeriod: { success: 4, error: 2 },
          emails: { attempted: 6, sent: 4, failed: 2, sendSuccessRate: 0.667 },
        },
      }),
    );

    expect(summary).toContain("2 fallaron");
    expect(summary).toContain("revisar la configuración de correo");
  });
});

describe("buildSummaryPrompt", () => {
  it("incluye las métricas agregadas y las reglas de no invención", () => {
    const prompt = buildSummaryPrompt(metrics());

    expect(prompt).toContain('"newInPeriod": 3');
    expect(prompt).toContain("inventes datos");
  });

  it("no contiene ningún dato personal: ni campos de cliente ni direcciones de correo", () => {
    const prompt = buildSummaryPrompt(metrics());

    // El contrato WeeklyReportMetrics no tiene campos personales; esta
    // prueba deja constancia de que el prompt tampoco los introduce.
    expect(prompt).not.toMatch(/customer|whatsapp|payload|nombre del cliente/i);
    expect(prompt).not.toContain("@");
  });
});

describe("parseSummaryOutput", () => {
  it("acepta la salida válida y la recorta", () => {
    expect(parseSummaryOutput('{"summary": "  Buena semana.  "}')).toBe("Buena semana.");
    const long = JSON.stringify({ summary: "x".repeat(2000) });
    expect(parseSummaryOutput(long)).toHaveLength(900);
  });

  it("rechaza JSON inválido, summary ausente o vacío", () => {
    expect(parseSummaryOutput(undefined)).toBeNull();
    expect(parseSummaryOutput("")).toBeNull();
    expect(parseSummaryOutput("no es json")).toBeNull();
    expect(parseSummaryOutput('"solo un string"')).toBeNull();
    expect(parseSummaryOutput('{"otro": "campo"}')).toBeNull();
    expect(parseSummaryOutput('{"summary": "   "}')).toBeNull();
  });
});

describe("defaultSummaryGenerator", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sin GEMINI_API_KEY usa el fallback determinístico sin tocar la red", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const generate = defaultSummaryGenerator();
    const result = await generate(EMPTY_WEEK);

    expect(result.source).toBe("fallback");
    expect(result.summary).toBe(buildFallbackSummary(EMPTY_WEEK));
  });
});

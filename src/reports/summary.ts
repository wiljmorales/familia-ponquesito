import { GoogleGenAI, Type } from "@google/genai";
import type { SummarySource, WeeklyReportMetrics } from "./types";

/**
 * Resumen ejecutivo del reporte semanal: Gemini cuando está disponible,
 * fallback determinístico siempre listo. Gemini nunca es punto único de
 * fallo — cualquier error (sin clave, timeout, cuota, salida inválida)
 * degrada al fallback y el reporte continúa. Mismo patrón de salida
 * estructurada + validación en servidor que src/providers/gemini.ts.
 */

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SUMMARY_LENGTH = 900;

export interface SummaryResult {
  summary: string;
  source: SummarySource;
}

/** Contrato inyectable en el servicio del reporte (pruebas sin red). */
export type SummaryGenerator = (metrics: WeeklyReportMetrics) => Promise<SummaryResult>;

const SOURCE_LABEL: Record<"cake_request" | "cake_design", string> = {
  cake_request: "del formulario de la landing",
  cake_design: "del juego Crea tu torta",
};

/**
 * Resumen determinístico construido solo con las métricas: frases fijas,
 * cero invención. Es el resultado cuando Gemini no está configurado o
 * falla, y también la referencia de qué debe poder decirse sin IA.
 */
export function buildFallbackSummary(metrics: WeeklyReportMetrics): string {
  const sentences: string[] = [];
  const { leads, automation, upcomingCelebrations } = metrics;

  if (leads.newInPeriod === 0) {
    sentences.push("Semana sin solicitudes nuevas.");
  } else {
    const bySourceParts = (Object.keys(SOURCE_LABEL) as Array<keyof typeof SOURCE_LABEL>)
      .filter((source) => leads.bySource[source] > 0)
      .map((source) => `${leads.bySource[source]} ${SOURCE_LABEL[source]}`);
    const detail = bySourceParts.length > 0 ? ` (${bySourceParts.join(" y ")})` : "";
    sentences.push(
      leads.newInPeriod === 1
        ? `Esta semana llegó 1 solicitud nueva${detail}.`
        : `Esta semana llegaron ${leads.newInPeriod} solicitudes nuevas${detail}.`,
    );
  }

  sentences.push(
    `El acumulado desde que la automatización está activa es de ${leads.totalAccumulated} ${
      leads.totalAccumulated === 1 ? "solicitud" : "solicitudes"
    }.`,
  );

  const pressing = leads.byPriority.urgent + leads.byPriority.high;
  if (pressing > 0) {
    sentences.push(
      pressing === 1
        ? "1 de las solicitudes nuevas tiene fecha cercana y conviene atenderla pronto."
        : `${pressing} de las solicitudes nuevas tienen fecha cercana y conviene atenderlas pronto.`,
    );
  }

  if (upcomingCelebrations.next7Days > 0) {
    sentences.push(
      upcomingCelebrations.next7Days === 1
        ? "Hay 1 celebración en los próximos 7 días."
        : `Hay ${upcomingCelebrations.next7Days} celebraciones en los próximos 7 días.`,
    );
  }

  if (automation.emails.attempted === 0) {
    sentences.push("No hubo envíos de correo automáticos en el periodo.");
  } else if (automation.emails.failed === 0) {
    sentences.push(
      `Los ${automation.emails.attempted} envíos de correo automáticos del periodo salieron con éxito.`,
    );
  } else {
    sentences.push(
      `De ${automation.emails.attempted} envíos de correo automáticos, ${automation.emails.failed} ${
        automation.emails.failed === 1 ? "falló" : "fallaron"
      }: conviene revisar la configuración de correo.`,
    );
  }

  return sentences.join(" ");
}

/**
 * Prompt para Gemini. Recibe EXCLUSIVAMENTE el JSON de métricas agregadas
 * (WeeklyReportMetrics): ningún nombre, correo, teléfono ni payload de
 * clientes entra a este texto.
 */
export function buildSummaryPrompt(metrics: WeeklyReportMetrics): string {
  return [
    "Redacta el resumen ejecutivo del reporte semanal interno de Familia",
    "Ponquesito, una repostería familiar de Barquisimeto (Venezuela). La",
    "lectora es Karem, la dueña del negocio.",
    "",
    "Reglas estrictas:",
    "- Usa únicamente los números del JSON de métricas de abajo. No",
    "  inventes datos, tendencias, causas ni comparaciones con semanas",
    "  anteriores.",
    "- Escribe entre 3 y 5 frases en español, tono cálido y profesional,",
    "  trato de usted.",
    "- Si la semana no tuvo actividad, dilo con naturalidad; es un",
    "  resultado válido.",
    "- No repitas el descargo de responsabilidad del campo dataDisclaimer:",
    "  ya se muestra aparte.",
    "- Responde solo el JSON pedido, sin texto adicional.",
    "",
    "Métricas de la semana:",
    JSON.stringify(metrics, null, 2),
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
  },
  required: ["summary"],
};

/**
 * Valida la salida cruda del modelo; null si no cumple el contrato (JSON
 * inválido, sin summary, o vacío). Quien llama decide el fallback.
 */
export function parseSummaryOutput(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) return null;

  const { summary } = data as Record<string, unknown>;
  if (typeof summary !== "string" || summary.trim().length === 0) return null;

  return summary.trim().slice(0, MAX_SUMMARY_LENGTH);
}

/**
 * Generador por defecto: Gemini con GEMINI_API_KEY configurada; fallback
 * determinístico en cualquier otro caso. Nunca lanza.
 */
export function defaultSummaryGenerator(): SummaryGenerator {
  return async (metrics: WeeklyReportMetrics): Promise<SummaryResult> => {
    if (!process.env.GEMINI_API_KEY) {
      return { summary: buildFallbackSummary(metrics), source: "fallback" };
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
        contents: [{ role: "user", parts: [{ text: buildSummaryPrompt(metrics) }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.3,
          maxOutputTokens: 400,
          httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        },
      });

      const summary = parseSummaryOutput(response.text);
      if (summary) return { summary, source: "gemini" };

      console.error("[reports] salida de Gemini inválida; se usa el fallback determinístico");
    } catch (error) {
      console.error(
        "[reports] Gemini falló al generar el resumen; se usa el fallback determinístico",
        error,
      );
    }

    return { summary: buildFallbackSummary(metrics), source: "fallback" };
  };
}

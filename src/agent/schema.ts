import { z } from "zod";
import {
  AGENT_INTENTS,
  AGENT_ROUTES,
  AGENT_URGENCIES,
  CANONICAL_ROUTE_BY_INTENT,
  MISSING_FIELDS,
  type AgentDecision,
} from "./types";

/**
 * Esquema cerrado de la decisión del agente (Reto 7), validado con Zod
 * (misma herramienta que las validaciones de los Retos 2/3). La salida del
 * modelo viene de un servicio externo: TypeScript no garantiza nada, así
 * que TODO se valida en servidor antes de tocar cualquier ruta del negocio.
 *
 * Criterio anti-invención: los campos "detectados" (código de pedido,
 * fecha) que no cumplen el formato esperado se normalizan a null en vez de
 * rechazar la decisión completa — los guardrails los re-derivan del mensaje
 * de forma determinista. Las incoherencias estructurales (intención↔ruta,
 * requiresHuman, confianza fuera de rango, campos desconocidos) sí
 * invalidan la decisión entera y disparan el fallback.
 */

const MAX_REASON_LENGTH = 600;
const MAX_ACTION_LENGTH = 400;

/** Códigos que el negocio realmente emite: pedidos demo del Reto 5 y códigos de referencia de los Retos 2/3. */
const ORDER_CODE_PATTERNS = [/^PED-\d{3}$/, /^FP-\d-[A-Z0-9]{4}$/];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeOrderCode(value: string | null): string | null {
  if (value === null) return null;
  const code = value.trim().toUpperCase();
  return ORDER_CODE_PATTERNS.some((pattern) => pattern.test(code)) ? code : null;
}

function normalizeIsoDate(value: string | null): string | null {
  if (value === null) return null;
  const date = value.trim();
  return ISO_DATE_PATTERN.test(date) ? date : null;
}

export const agentDecisionSchema = z
  .strictObject({
    intent: z.enum(AGENT_INTENTS),
    confidence: z.number().min(0).max(1),
    reason: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.slice(0, MAX_REASON_LENGTH)),
    route: z.enum(AGENT_ROUTES),
    urgency: z.enum(AGENT_URGENCIES),
    requiresHuman: z.boolean(),
    detectedOrderCode: z.string().nullable().transform(normalizeOrderCode),
    detectedCelebrationDate: z.string().nullable().transform(normalizeIsoDate),
    missingFields: z
      .array(z.enum(MISSING_FIELDS))
      .transform((fields) => [...new Set(fields)]),
    recommendedAction: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.slice(0, MAX_ACTION_LENGTH)),
  })
  .superRefine((decision, ctx) => {
    const canonical = CANONICAL_ROUTE_BY_INTENT[decision.intent];
    const routeIsCoherent =
      decision.route === canonical ||
      (decision.route === "human_escalation" && decision.requiresHuman);

    if (!routeIsCoherent) {
      ctx.addIssue({
        code: "custom",
        message: `La ruta "${decision.route}" no corresponde a la intención "${decision.intent}".`,
        path: ["route"],
      });
    }

    if (decision.route === "human_escalation" && !decision.requiresHuman) {
      ctx.addIssue({
        code: "custom",
        message: "Escalar a humano exige requiresHuman = true.",
        path: ["requiresHuman"],
      });
    }

    if (decision.intent === "sensitive_or_urgent_case" && !decision.requiresHuman) {
      ctx.addIssue({
        code: "custom",
        message: "Un caso sensible siempre requiere intervención humana.",
        path: ["requiresHuman"],
      });
    }

    if (decision.intent === "missing_information" && decision.missingFields.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Información insuficiente exige declarar qué campos faltan.",
        path: ["missingFields"],
      });
    }
  });

/**
 * Valida la salida cruda del modelo. Devuelve null si no cumple el
 * contrato; quien llama decide el fallback (mismo patrón que
 * parseModelOutput del Reto 1 y parseSummaryOutput del Reto 6).
 */
export function parseAgentDecision(raw: string | undefined): AgentDecision | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = agentDecisionSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Decisión segura cuando el análisis con IA falla (error, timeout, JSON
 * inválido, incoherencia). Un mensaje que no se pudo interpretar es, por
 * definición, una "situación ambigua con riesgo": nunca se pierde, siempre
 * termina en revisión humana y jamás dispara acciones automáticas.
 */
export function buildFallbackDecision(detail: string): AgentDecision {
  return {
    intent: "sensitive_or_urgent_case",
    confidence: 0,
    reason:
      "No se pudo determinar una ruta segura de forma automática " +
      `(${detail}). El mensaje pasa a revisión humana para no perderlo ` +
      "ni responder algo incorrecto.",
    route: "human_escalation",
    urgency: "high",
    requiresHuman: true,
    detectedOrderCode: null,
    detectedCelebrationDate: null,
    missingFields: [],
    recommendedAction:
      "Revisar el mensaje manualmente y responder por el canal en que llegó.",
  };
}

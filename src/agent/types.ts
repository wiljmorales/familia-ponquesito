/**
 * Tipos del Agente de Atención Ponquesito (Reto 7).
 *
 * Contrato entre las cinco piezas del agente: interpretación con IA
 * (analyze), guardrails deterministas, router, ejecutores y registro. La IA
 * solo interpreta lenguaje; toda política del negocio vive en código
 * (guardrails.ts) y prevalece sobre la salida del modelo.
 */

export const AGENT_INTENTS = [
  "new_order",
  "general_question",
  "missing_information",
  "order_change_or_cancellation",
  "sensitive_or_urgent_case",
] as const;

export type AgentIntent = (typeof AGENT_INTENTS)[number];

export const AGENT_ROUTES = [
  "lead_automation",
  "knowledge_answer",
  "request_information",
  "order_review",
  "human_escalation",
] as const;

export type AgentRoute = (typeof AGENT_ROUTES)[number];

export const AGENT_URGENCIES = ["low", "normal", "high", "critical"] as const;

export type AgentUrgency = (typeof AGENT_URGENCIES)[number];

/**
 * Datos que el agente puede declarar como faltantes. Lista cerrada: el
 * modelo no puede inventar campos nuevos (el esquema rechaza cualquier
 * valor fuera de esta lista).
 */
export const MISSING_FIELDS = [
  "celebration_date",
  "guest_count",
  "flavor",
  "cake_description",
  "delivery_zone",
  "contact",
] as const;

export type MissingField = (typeof MISSING_FIELDS)[number];

/**
 * Ruta canónica de cada intención. El esquema valida que el modelo respete
 * este mapa (con la única excepción de escalar a humano cuando
 * requiresHuman es true).
 */
export const CANONICAL_ROUTE_BY_INTENT: Record<AgentIntent, AgentRoute> = {
  new_order: "lead_automation",
  general_question: "knowledge_answer",
  missing_information: "request_information",
  order_change_or_cancellation: "order_review",
  sensitive_or_urgent_case: "human_escalation",
};

export interface AgentDecision {
  intent: AgentIntent;
  /** Entre 0 y 1 (validado por el esquema). */
  confidence: number;
  reason: string;
  route: AgentRoute;
  urgency: AgentUrgency;
  requiresHuman: boolean;
  /** Código citado en el mensaje (PED-001, FP-2-XXXX); null si no hay. */
  detectedOrderCode: string | null;
  /**
   * "YYYY-MM-DD" de la celebración mencionada en el mensaje, resuelta a
   * fecha absoluta; null si el mensaje no la menciona. No está en la
   * propuesta original del reto: se agrega porque los guardrails de
   * anticipación mínima (3 días / mismo día) necesitan la fecha para
   * aplicarse de forma determinista.
   */
  detectedCelebrationDate: string | null;
  missingFields: MissingField[];
  recommendedAction: string;
}

/** Igual que summary_source del Reto 6: quién produjo la decisión. */
export type DecisionSource = "gemini" | "fallback";

export interface AgentAnalysis {
  decision: AgentDecision;
  source: DecisionSource;
  /** Presente solo cuando source === "fallback": por qué se degradó. */
  fallbackReason?: string;
}

/**
 * Un analizador convierte el mensaje libre en una decisión estructurada.
 * Lo implementa el analizador real (Gemini) y cualquier doble de prueba;
 * nunca lanza: ante cualquier fallo devuelve la decisión de fallback.
 */
export type AgentAnalyzer = (message: string) => Promise<AgentAnalysis>;

/** Corrección aplicada por una regla determinista sobre la decisión. */
export interface GuardrailCorrection {
  /** Identificador corto de la regla (ej. "seguridad-alimentaria"). */
  rule: string;
  /** Explicación visible para la demo. */
  description: string;
}

/** Contacto simulado que acompaña a los casos de demostración. */
export interface AgentContact {
  name: string;
  email: string;
  whatsapp: string;
}

export interface AgentMessageInput {
  message: string;
  /** Etiqueta de la fuente simulada, ej. "WhatsApp (simulado)". */
  sourceLabel: string;
  /** id del caso de demostración precargado; null para mensajes libres. */
  demoCaseId: string | null;
  /** null cuando el mensaje libre no trae datos de contacto. */
  contact: AgentContact | null;
}

/** Estado final de un caso procesado (los contadores se derivan de esto). */
export const AGENT_CASE_STATUSES = [
  "lead_registered",
  "answered",
  "waiting_information",
  "escalated_to_human",
  "not_executed",
] as const;

export type AgentCaseStatus = (typeof AGENT_CASE_STATUSES)[number];

export interface AgentExecutionResult {
  status: AgentCaseStatus;
  /** Qué se hizo realmente (sin afirmar nada que no haya ocurrido). */
  executedAction: string;
  /** Líneas adicionales visibles (ej. la respuesta de la base de conocimiento). */
  details: string[];
}

/** Resultado completo de procesar un mensaje, listo para la demo. */
export interface AgentCaseResult {
  input: AgentMessageInput;
  decision: AgentDecision;
  decisionSource: DecisionSource;
  fallbackReason: string | null;
  guardrailCorrections: GuardrailCorrection[];
  route: AgentRoute;
  execution: AgentExecutionResult;
  /** Pasos de la línea de tiempo, en orden. */
  timeline: string[];
  /** true si la decisión quedó registrada en agent_decisions. */
  persisted: boolean;
}

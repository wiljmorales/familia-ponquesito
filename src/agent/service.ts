import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AGENT_DECISIONS_TABLE } from "@/lib/supabase/config";
import type { EmailClient } from "@/email/client";
import type { AssistantReply } from "@/assistant/types";
import type { processLead } from "@/leads/service";
import { businessTodayISO } from "@/lib/prototype/dates";
import { createPrototypeOrders, DEMO_PHONE } from "@/data/prototype-orders";
import type { PrototypeOrder } from "@/types/prototype";
import { defaultAgentAnalyzer } from "./analyze";
import { applyBusinessGuardrails } from "./guardrails";
import { routeAgentDecision } from "./router";
import { buildFallbackDecision } from "./schema";
import { executeAgentRoute } from "./execute";
import { findDemoCase } from "./demo-cases";
import { CASE_STATUS_LABEL, INTENT_LABEL, ROUTE_LABEL } from "./labels";
import type {
  AgentAnalysis,
  AgentAnalyzer,
  AgentCaseResult,
  AgentContact,
  AgentMessageInput,
} from "./types";

/**
 * Orquestador del Agente de Atención Ponquesito (Reto 7):
 * mensaje libre → interpretación con IA (o fallback) → guardrails del
 * negocio → router → ejecutor de la ruta → registro en agent_decisions.
 *
 * Nunca lanza salvo AgentInputError (entrada inválida del cliente, que el
 * endpoint traduce a 400): cualquier fallo interno degrada a revisión
 * humana y el mensaje jamás se pierde.
 */

/** Entrada inválida del cliente; el endpoint la traduce a un 400. */
export class AgentInputError extends Error {}

export const MAX_AGENT_MESSAGE_LENGTH = 1000;

/** Fuente de los mensajes escritos a mano en la página /agente. */
export const FREE_MESSAGE_SOURCE_LABEL = "Mensaje directo (demostración)";

export interface ProcessAgentMessageDeps {
  /** Inyectable para pruebas; por defecto Gemini con fallback determinista. */
  analyzer?: AgentAnalyzer;
  /** Inyectable para pruebas; null explícito = sin persistencia. */
  supabase?: SupabaseClient | null;
  /** Inyectable para pruebas; lo consume processLead (Reto 4). */
  emailClient?: EmailClient;
  /** Inyectable para pruebas; por defecto el asistente del Reto 1. */
  askKnowledge?: (message: string) => Promise<AssistantReply>;
  /** Inyectable para pruebas; por defecto processLead del Reto 4. */
  processLeadFn?: typeof processLead;
  /** Inyectable para pruebas; por defecto process.env.KAREM_NOTIFICATION_EMAIL. */
  karemEmail?: string;
  /** Inyectable para pruebas deterministas; por defecto la hora real. */
  now?: Date;
  /** Inyectable para pruebas; por defecto los pedidos demo del Reto 5. */
  orders?: PrototypeOrder[];
}

/**
 * Contacto simulado de los casos demo que lo requieren (caso 1). El correo
 * sale de variables de entorno privadas (nunca del bundle del cliente):
 * AGENT_DEMO_CUSTOMER_EMAIL si existe, o el correo de notificaciones ya
 * configurado del Reto 4 — así los correos reales de la demo llegan a una
 * casilla que el negocio controla, no a un tercero inventado.
 */
export function resolveDemoContact(): AgentContact | null {
  const email =
    process.env.AGENT_DEMO_CUSTOMER_EMAIL?.trim() ||
    process.env.KAREM_NOTIFICATION_EMAIL?.trim();
  if (!email) return null;
  return {
    name: "Cliente de demostración (Reto 7)",
    email,
    whatsapp: DEMO_PHONE,
  };
}

/**
 * Valida la entrada del cliente y la convierte en AgentMessageInput. Para
 * los casos demo el servidor usa SIEMPRE el mensaje canónico del caso (el
 * cliente solo envía el id): evita manipulaciones y mantiene la demo
 * honesta.
 */
export function parseAgentRequest(raw: unknown): AgentMessageInput {
  if (typeof raw !== "object" || raw === null) {
    throw new AgentInputError("El cuerpo debe ser un objeto JSON.");
  }

  const { message, demoCaseId } = raw as Record<string, unknown>;

  if (demoCaseId !== undefined && demoCaseId !== null) {
    if (typeof demoCaseId !== "string") {
      throw new AgentInputError('El campo "demoCaseId" debe ser texto.');
    }
    const demoCase = findDemoCase(demoCaseId);
    if (!demoCase) {
      throw new AgentInputError(`No existe el caso de demostración "${demoCaseId}".`);
    }
    return {
      message: demoCase.message,
      sourceLabel: demoCase.sourceLabel,
      demoCaseId: demoCase.id,
      contact: demoCase.hasSimulatedContact ? resolveDemoContact() : null,
    };
  }

  if (typeof message !== "string") {
    throw new AgentInputError('Falta el campo "message" (texto).');
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new AgentInputError("El mensaje no puede estar vacío.");
  }
  if (trimmed.length > MAX_AGENT_MESSAGE_LENGTH) {
    throw new AgentInputError(
      `El mensaje supera el máximo de ${MAX_AGENT_MESSAGE_LENGTH} caracteres.`,
    );
  }

  return {
    message: trimmed,
    sourceLabel: FREE_MESSAGE_SOURCE_LABEL,
    demoCaseId: null,
    contact: null,
  };
}

function safeGetSupabase(): SupabaseClient | null {
  try {
    return getSupabaseServiceClient();
  } catch (error) {
    console.error("[agent] Supabase no está configurado; la demo sigue sin registrar", error);
    return null;
  }
}

export async function processAgentMessage(
  rawInput: unknown,
  deps: ProcessAgentMessageDeps = {},
): Promise<AgentCaseResult> {
  const input = parseAgentRequest(rawInput);

  const now = deps.now ?? new Date();
  const todayISO = businessTodayISO(now);
  const orders = deps.orders ?? createPrototypeOrders(todayISO);

  // Cinturón adicional al del analizador: ni siquiera un analizador
  // inyectado que lance puede tumbar el procesamiento del mensaje.
  let analysis: AgentAnalysis;
  try {
    analysis = await (deps.analyzer ?? defaultAgentAnalyzer(todayISO))(input.message);
  } catch (error) {
    console.error("[agent] el analizador lanzó; se usa el fallback", error);
    analysis = {
      decision: buildFallbackDecision("el análisis falló de forma inesperada"),
      source: "fallback",
      fallbackReason: "El análisis falló de forma inesperada.",
    };
  }

  const { decision, corrections } = applyBusinessGuardrails(analysis.decision, {
    message: input.message,
    todayISO,
    orders,
    hasContact: input.contact !== null,
  });

  const route = routeAgentDecision(decision);

  const supabase = deps.supabase !== undefined ? deps.supabase : safeGetSupabase();

  // Reserva la fila ANTES de ejecutar (patrón del Reto 6): si la ruta es la
  // máquina de leads, esta fila es la "fila original" del lead
  // (source_type = 'agent_message', source_id = decisionId).
  let decisionId: string | null = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(AGENT_DECISIONS_TABLE)
      .insert({
        source: input.sourceLabel,
        source_record_id: input.demoCaseId,
        input_content: input.message,
        intent: decision.intent,
        route,
        urgency: decision.urgency,
        confidence: decision.confidence,
        requires_human: decision.requiresHuman,
        reason: decision.reason,
        missing_fields: decision.missingFields,
        detected_order_code: decision.detectedOrderCode,
        recommended_action: decision.recommendedAction,
        guardrail_corrections: corrections,
        decision_source: analysis.source,
        status: "processing",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[agent] fallo al registrar la decisión", error);
    } else {
      decisionId = (data as { id: string }).id;
    }
  }

  const execution = await executeAgentRoute(route, decision, input, {
    supabase,
    decisionId,
    emailClient: deps.emailClient,
    processLeadFn: deps.processLeadFn,
    askKnowledge: deps.askKnowledge,
    karemEmail: deps.karemEmail,
    orders,
    todayISO,
  });

  if (supabase && decisionId) {
    const { error } = await supabase
      .from(AGENT_DECISIONS_TABLE)
      .update({ executed_action: execution.executedAction, status: execution.status })
      .eq("id", decisionId);
    if (error) {
      console.error("[agent] fallo al completar la fila de la decisión", error);
    }
  }

  const timeline: string[] = [
    `Mensaje recibido — ${input.sourceLabel}`,
    analysis.source === "gemini"
      ? "Analizado por Gemini (salida validada en servidor)"
      : `Análisis con IA no disponible: fallback determinista (${analysis.fallbackReason ?? "sin detalle"})`,
    `Intención: ${INTENT_LABEL[decision.intent]}`,
  ];
  if (decision.detectedOrderCode) {
    timeline.push(`Pedido ${decision.detectedOrderCode} identificado`);
  }
  for (const correction of corrections) {
    timeline.push(`Política del negocio aplicada: ${correction.description}`);
  }
  timeline.push(`Ruta seleccionada: ${ROUTE_LABEL[route]}`);
  timeline.push(`${execution.executedAction}`);
  timeline.push(`Estado final: ${CASE_STATUS_LABEL[execution.status]}`);

  return {
    input,
    decision,
    decisionSource: analysis.source,
    fallbackReason: analysis.fallbackReason ?? null,
    guardrailCorrections: corrections,
    route,
    execution,
    timeline,
    persisted: decisionId !== null,
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEADS_TABLE } from "@/lib/supabase/config";
import { processLead } from "@/leads/service";
import type { LeadPriority } from "@/leads/classify";
import type { EmailClient } from "@/email/client";
import { askAssistant } from "@/assistant/service";
import type { AssistantReply } from "@/assistant/types";
import { normalizeWhatsapp } from "@/lib/utils/whatsapp";
import { daysBetweenISO } from "@/lib/business-dates";
import { STATUS_LABEL } from "@/components/prototype/StatusBadge";
import type { PrototypeOrder } from "@/types/prototype";
import { INTENT_LABEL, MISSING_FIELD_LABEL, URGENCY_LABEL } from "./labels";
import type {
  AgentDecision,
  AgentExecutionResult,
  AgentMessageInput,
  AgentRoute,
} from "./types";

/**
 * Ejecutores del agente (Reto 7): una función por ruta, cada una con una
 * consecuencia distinta y honesta — lo que no se ejecutó de verdad se dice
 * como preparado o simulado, nunca como hecho. Ningún ejecutor lanza hacia
 * afuera: el servicio recibe siempre un resultado descriptivo.
 */

export interface ExecuteAgentRouteDeps {
  /** null cuando Supabase no está configurado (la demo sigue, sin registrar). */
  supabase: SupabaseClient | null;
  /** id de la fila reservada en agent_decisions; null si no se pudo registrar. */
  decisionId: string | null;
  /** Inyectable para pruebas; por defecto el flujo real de processLead. */
  emailClient?: EmailClient;
  /** Inyectable para pruebas; por defecto processLead del Reto 4. */
  processLeadFn?: typeof processLead;
  /** Inyectable para pruebas; por defecto el asistente del Reto 1. */
  askKnowledge?: (message: string) => Promise<AssistantReply>;
  /** Inyectable para pruebas; lo consume processLead (Reto 4). */
  karemEmail?: string;
  orders: PrototypeOrder[];
  todayISO: string;
}

const PRIORITY_LABEL: Record<LeadPriority, string> = {
  not_viable: "No viable (menos de 3 días)",
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
};

export async function executeAgentRoute(
  route: AgentRoute,
  decision: AgentDecision,
  input: AgentMessageInput,
  deps: ExecuteAgentRouteDeps,
): Promise<AgentExecutionResult> {
  try {
    switch (route) {
      case "lead_automation":
        return await executeLeadAutomation(decision, input, deps);
      case "knowledge_answer":
        return await executeKnowledgeAnswer(input, deps);
      case "request_information":
        return executeRequestInformation(decision);
      case "order_review":
        return executeOrderReview(decision, deps);
      case "human_escalation":
        return executeHumanEscalation(decision);
    }
  } catch (error) {
    console.error(`[agent] fallo inesperado ejecutando la ruta ${route}`, error);
    return {
      status: "escalated_to_human",
      executedAction:
        "La ejecución de la ruta falló de forma inesperada: el caso pasa a revisión humana para no perder el mensaje.",
      details: [],
    };
  }
}

/**
 * Ruta 1 — reutiliza processLead() del Reto 4 tal cual (no se duplica).
 * Tras invocarlo se consulta la tabla leads para confirmar el registro:
 * processLead no devuelve resultado y jamás se afirma un registro que no
 * se pueda verificar.
 */
async function executeLeadAutomation(
  decision: AgentDecision,
  input: AgentMessageInput,
  deps: ExecuteAgentRouteDeps,
): Promise<AgentExecutionResult> {
  if (!input.contact) {
    // Los guardrails redirigen este caso antes de llegar aquí; cinturón.
    return {
      status: "not_executed",
      executedAction:
        "No se puede registrar el lead: el mensaje no trae datos de contacto (correo y WhatsApp).",
      details: [],
    };
  }

  if (!deps.supabase || !deps.decisionId) {
    return {
      status: "not_executed",
      executedAction:
        "No se puede registrar el lead: la base de datos no está disponible en este entorno. El mensaje no se pierde (queda visible en la demo).",
      details: [],
    };
  }

  if (!decision.detectedCelebrationDate) {
    return {
      status: "not_executed",
      executedAction:
        "No se puede registrar el lead sin la fecha de la celebración (la clasificación del Reto 4 la necesita).",
      details: [],
    };
  }

  const runProcessLead = deps.processLeadFn ?? processLead;
  await runProcessLead(
    {
      source: "agent_message",
      sourceId: deps.decisionId,
      customerName: input.contact.name,
      customerWhatsapp: normalizeWhatsapp(input.contact.whatsapp),
      customerEmail: input.contact.email,
      celebrationDate: decision.detectedCelebrationDate,
      summaryLines: [
        `Mensaje recibido por ${input.sourceLabel}: "${input.message}"`,
        `Intención detectada por el agente: ${INTENT_LABEL[decision.intent]}`,
        `Fecha de celebración mencionada: ${decision.detectedCelebrationDate}`,
        "Datos de demostración del Reto 7 (Platzi Vibe Coding Challenge).",
      ],
      normalizedPayload: {
        message: input.message,
        sourceLabel: input.sourceLabel,
        demoCaseId: input.demoCaseId,
        challenge: "reto-7",
      },
    },
    { supabase: deps.supabase, emailClient: deps.emailClient, karemEmail: deps.karemEmail },
  );

  const { data, error } = await deps.supabase
    .from(LEADS_TABLE)
    .select("reference_code, priority")
    .eq("source_type", "agent_message")
    .eq("source_id", deps.decisionId)
    .maybeSingle();

  const lead = data as { reference_code: string; priority: LeadPriority } | null;

  if (error || !lead) {
    return {
      status: "not_executed",
      executedAction:
        "Se invocó la máquina de leads pero el registro no pudo confirmarse: el caso queda para revisión manual (detalle en los logs del servidor).",
      details: [],
    };
  }

  return {
    status: "lead_registered",
    executedAction:
      `Lead ${lead.reference_code} registrado con processLead() del Reto 4 ` +
      `(prioridad ${PRIORITY_LABEL[lead.priority]}) y enviado al flujo comercial.`,
    details: [
      "La automatización del Reto 4 intentó el correo de confirmación al cliente y la notificación a Karem; el resultado real de cada envío queda en lead_automation_events.",
      "Contacto del lead: datos de demostración del Reto 7, claramente marcados como simulados.",
    ],
  };
}

/**
 * Ruta 2 — reutiliza el asistente del Reto 1 (base de conocimiento) sin
 * crear ningún lead.
 */
async function executeKnowledgeAnswer(
  input: AgentMessageInput,
  deps: ExecuteAgentRouteDeps,
): Promise<AgentExecutionResult> {
  const ask = deps.askKnowledge ?? ((message: string) => askAssistant({ message }));

  let reply: AssistantReply;
  try {
    reply = await ask(input.message);
  } catch (error) {
    console.error("[agent] el asistente del Reto 1 falló al responder la consulta", error);
    return {
      status: "escalated_to_human",
      executedAction:
        "No se pudo generar la respuesta automática con la base de conocimiento: el mensaje queda marcado para respuesta manual.",
      details: [],
    };
  }

  return {
    status: "answered",
    executedAction:
      "Consulta respondida con la base de conocimiento del Reto 1; no se creó ningún lead.",
    details: [`Respuesta del asistente: ${reply.reply}`],
  };
}

/** Ruta 3 — pide SOLO los datos faltantes, sin inventar precios ni fechas. */
function executeRequestInformation(decision: AgentDecision): AgentExecutionResult {
  const fields = decision.missingFields.map((field) => MISSING_FIELD_LABEL[field]);
  const ask =
    "¡Gracias por escribirnos! Para avanzar con tu torta necesitamos estos datos: " +
    `${fields.join(", ")}. ` +
    "El precio se confirma con esa información; preferimos no adelantar montos para no equivocarnos.";

  return {
    status: "waiting_information",
    executedAction:
      "Se preparó la solicitud de los datos faltantes; el caso queda en espera de información.",
    details: [`Respuesta preparada: ${ask}`],
  };
}

/**
 * Ruta 4 — evalúa la solicitud contra los pedidos del prototipo del Reto 5
 * y SIEMPRE escala la confirmación a Karem: ningún cambio o cancelación se
 * afirma como aceptado automáticamente.
 */
function executeOrderReview(
  decision: AgentDecision,
  deps: ExecuteAgentRouteDeps,
): AgentExecutionResult {
  const code = decision.detectedOrderCode;

  if (!code) {
    return {
      status: "waiting_information",
      executedAction:
        "El mensaje no cita el código del pedido: se solicita antes de poder revisarlo.",
      details: [
        "Respuesta preparada: ¿Nos indicas el código de tu pedido (por ejemplo PED-001) para revisar tu solicitud?",
      ],
    };
  }

  const order = deps.orders.find((candidate) => candidate.id === code);

  if (!order) {
    return {
      status: "escalated_to_human",
      executedAction: `El pedido ${code} no aparece en los registros disponibles: Karem debe verificarlo manualmente.`,
      details: [
        `Notificación para Karem (simulada): un cliente cita el pedido ${code}, que no está en los datos del prototipo del Reto 5.`,
      ],
    };
  }

  const daysUntil = daysBetweenISO(deps.todayISO, order.celebrationDate);
  const preparationMayHaveStarted = order.status === "confirmed";

  return {
    status: "escalated_to_human",
    executedAction:
      `Solicitud evaluada con los datos del pedido ${order.id} (Reto 5) y escalada a Karem: ` +
      "el cambio no se confirma automáticamente.",
    details: [
      `Pedido ${order.id}: ${order.celebrationType}, sabor ${order.flavor}, ` +
        `celebración el ${order.celebrationDate} (en ${daysUntil} día${daysUntil === 1 ? "" : "s"}), ` +
        `estado "${STATUS_LABEL[order.status]}".`,
      preparationMayHaveStarted
        ? "El pedido ya está confirmado y puede estar en preparación: la política solo permite cambios si la preparación no ha comenzado."
        : "Según el estado registrado, la preparación no ha comenzado; aun así el cambio requiere confirmación de Karem.",
      `Notificación para Karem (simulada): revisar la solicitud de cambio del pedido ${order.id} — urgencia ${URGENCY_LABEL[decision.urgency]}.`,
    ],
  };
}

/** Ruta 5 — detiene toda respuesta automática y marca el caso para Karem. */
function executeHumanEscalation(decision: AgentDecision): AgentExecutionResult {
  return {
    status: "escalated_to_human",
    executedAction:
      "Respuesta automática detenida: el caso quedó marcado para revisión humana inmediata, sin promesas de seguridad alimentaria, disponibilidad ni resolución.",
    details: [
      `Notificación para Karem (simulada): ${decision.reason}`,
      `Urgencia registrada: ${URGENCY_LABEL[decision.urgency]}.`,
    ],
  };
}

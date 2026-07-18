import type {
  AgentCaseStatus,
  AgentIntent,
  AgentRoute,
  AgentUrgency,
  DecisionSource,
  MissingField,
} from "./types";

/**
 * Etiquetas en español de los valores del agente (Reto 7), compartidas por
 * los ejecutores (textos de acciones y solicitudes) y la página /agente.
 */

export const INTENT_LABEL: Record<AgentIntent, string> = {
  new_order: "Nuevo pedido",
  general_question: "Consulta general",
  missing_information: "Posible pedido con información incompleta",
  order_change_or_cancellation: "Cambio o cancelación de pedido",
  sensitive_or_urgent_case: "Caso sensible o urgente",
};

export const ROUTE_LABEL: Record<AgentRoute, string> = {
  lead_automation: "Máquina de leads (Reto 4)",
  knowledge_answer: "Base de conocimiento (Reto 1)",
  request_information: "Solicitar información",
  order_review: "Revisión del pedido (Reto 5)",
  human_escalation: "Intervención humana (Karem)",
};

export const URGENCY_LABEL: Record<AgentUrgency, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

export const CASE_STATUS_LABEL: Record<AgentCaseStatus, string> = {
  lead_registered: "Lead registrado",
  answered: "Consulta respondida",
  waiting_information: "Esperando información",
  escalated_to_human: "En revisión humana",
  not_executed: "No ejecutado",
};

export const DECISION_SOURCE_LABEL: Record<DecisionSource, string> = {
  gemini: "Gemini (validado en servidor)",
  fallback: "Fallback determinista",
};

export const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  celebration_date: "fecha de la celebración",
  guest_count: "cantidad de personas",
  flavor: "sabor deseado",
  cake_description: "descripción o diseño de la torta",
  delivery_zone: "zona de entrega o si prefiere retiro",
  contact: "correo y número de WhatsApp de contacto",
};

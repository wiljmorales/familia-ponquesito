/**
 * Tipos compartidos del asistente (Reto 1).
 * Contrato entre UI, endpoint, servicio y proveedor.
 */

/**
 * - "answered": el asistente respondió con información que sí tiene.
 * - "unknown": el asistente no tiene la información y lo admite.
 * - "human_required": la solicitud debe atenderla una persona.
 */
export type AssistantStatus = "answered" | "unknown" | "human_required";

/** Turno previo de la conversación, para dar contexto al proveedor. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantRequest {
  message: string;
  /** Últimos turnos de la conversación (acotado por el servicio). */
  history?: ChatTurn[];
}

export interface AssistantReply {
  status: AssistantStatus;
  reply: string;
}

/**
 * Un proveedor recibe la solicitud ya validada y produce la respuesta.
 * Lo implementan el proveedor temporal determinista (pruebas y entorno sin
 * clave) y el proveedor real de Gemini; cualquier proveedor futuro debe
 * cumplir esta misma firma.
 */
export type AssistantProvider = (
  request: AssistantRequest,
) => Promise<AssistantReply>;

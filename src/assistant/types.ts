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

export interface AssistantRequest {
  message: string;
}

export interface AssistantReply {
  status: AssistantStatus;
  reply: string;
}

/**
 * Un proveedor recibe el mensaje ya validado y produce la respuesta.
 * El proveedor temporal determinista implementa esta firma; una futura
 * integración de IA real deberá implementar la misma.
 */
export type AssistantProvider = (message: string) => Promise<AssistantReply>;

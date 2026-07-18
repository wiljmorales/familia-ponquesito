/**
 * "agent_message" (Reto 7): leads que nacen de un mensaje libre analizado
 * por el Agente de Atención; la fila original vive en agent_decisions.
 */
export type LeadSourceType = "cake_request" | "cake_design" | "agent_message";

export interface ProcessLeadInput {
  source: LeadSourceType;
  /** id de la fila original en cake_requests, cake_designs o agent_decisions. */
  sourceId: string;
  customerName: string;
  /** Ya normalizado a formato internacional (normalizeWhatsapp). */
  customerWhatsapp: string;
  customerEmail: string;
  /** "YYYY-MM-DD" (celebration_date / event_date). */
  celebrationDate: string;
  /** Líneas de resumen ya construidas (describeCakeRequest/describeCakeDesign). */
  summaryLines: string[];
  /** Payload completo para normalized_payload (jsonb), reconstruible sin la fila original. */
  normalizedPayload: Record<string, unknown>;
  /**
   * Código ya generado por el flujo de origen (Reto 3: design_code). Si se
   * omite (Reto 2), processLead genera uno nuevo con el prefijo FP-2.
   */
  referenceCode?: string;
  /** Solo Reto 2: ruta del objeto en el bucket privado cake-references. */
  referenceImagePath?: string | null;
}

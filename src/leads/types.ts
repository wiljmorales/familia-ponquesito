/**
 * "agent_message" (Reto 7): leads que nacen de un mensaje libre analizado
 * por el Agente de Atención; la fila original vive en agent_decisions.
 * "cake_reservation" (Reto 8): leads que nacen de una reserva de la
 * Agenda Ponquesito; la fila original vive en cake_reservations.
 */
export type LeadSourceType =
  | "cake_request"
  | "cake_design"
  | "agent_message"
  | "cake_reservation";

/**
 * Detalles seguros y persistibles de una reserva (Reto 8). No contiene
 * secretos ni estado de transporte: el enlace privado y la capacidad
 * posterior al RPC viajan en ReservationEmailContext, separado.
 */
export interface ReservationLeadDetails {
  /** Código real generado por el servidor y devuelto por el RPC. */
  code: string;
  celebrationDate: string;
  status: "pending_deposit" | "human_review";
  /** Peso interno calculado en servidor; human_review no lo consume. */
  capacityPoints: CapacityPoints;
  /** Motivos legibles de la clasificación determinística. */
  classificationReasons: string[];
  guestCount: number;
  flavorLabel: string;
  theme?: string;
  designDescription: string;
  fulfillmentType: "pickup" | "delivery";
  deliveryDetails?: string;
  /** El cliente DICE tener una referencia visual (la agenda no sube archivos). */
  hasReferenceImage: boolean;
}

export interface ProcessLeadInput {
  source: LeadSourceType;
  /** id de la fila original en cake_requests, cake_designs, agent_decisions o cake_reservations. */
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
   * Código ya generado por el flujo de origen (Reto 3: design_code;
   * Reto 8: código de la reserva). Si se omite (Reto 2), processLead
   * genera uno nuevo con el prefijo de la fuente.
   */
  referenceCode?: string;
  /** Solo Reto 2: ruta del objeto en el bucket privado cake-references. */
  referenceImagePath?: string | null;
  /** Solo Reto 8: datos seguros de la reserva; nunca secretos transitorios. */
  reservation?: ReservationLeadDetails;
}
import type { CapacityPoints } from "@/reservations/capacity";

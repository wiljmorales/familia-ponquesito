/**
 * Contratos del dominio de Agenda Ponquesito (Reto 8): reservas de
 * capacidad diaria de producción. La autoridad sobre capacidad, bloqueos y
 * estados que consumen cupo es PostgreSQL (ver supabase/schema.sql,
 * sección Reto 8); estos tipos describen ese contrato del lado TypeScript
 * y src/reservations/sql-alignment.test.ts vigila que no diverjan.
 */

/**
 * Estados de una reserva. "expired" queda reservado para una evolución
 * posterior (expiración automática de reservas sin anticipo); en este MVP
 * ninguna ruta lo asigna y no existe ningún cron que lo produzca.
 */
export const RESERVATION_STATUSES = [
  "pending_deposit",
  "confirmed",
  "human_review",
  "cancelled",
  "expired",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Estados que consumen capacidad del día. "human_review" NO consume a
 * propósito: aún no se sabe cuántos puntos pesa realmente el pedido y una
 * solicitud ambigua o maliciosa no debe bloquear fechas; la fecha queda
 * "solicitada, no reservada" hasta que el negocio la revise.
 */
export const CAPACITY_CONSUMING_STATUSES = ["pending_deposit", "confirmed"] as const;

/** Estados con los que puede nacer una reserva vía reserve_production_slot. */
export const INITIAL_RESERVATION_STATUSES = ["pending_deposit", "human_review"] as const;

/** Estados desde los cuales el cliente puede reprogramar o cancelar. */
export const MODIFIABLE_RESERVATION_STATUSES = [
  "pending_deposit",
  "confirmed",
  "human_review",
] as const;

export const FULFILLMENT_TYPES = ["pickup", "delivery"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

/**
 * Códigos de error que devuelven los RPC del Reto 8 (campo `error` del
 * jsonb de respuesta). "reservation_not_found" cubre a propósito tanto el
 * código inexistente como el token inválido: distinguirlos permitiría
 * enumerar códigos de reservas reales.
 */
export type ReservationErrorCode =
  | "missing_data"
  | "invalid_points"
  | "invalid_status"
  | "too_soon"
  | "out_of_window"
  | "date_blocked"
  | "capacity_unavailable"
  | "code_taken"
  | "reservation_not_found"
  | "status_not_modifiable"
  | "status_not_cancellable"
  | "already_cancelled"
  | "change_window_closed"
  | "cancellation_window_closed"
  | "same_date";

/** Fila que devuelve get_production_availability (solo agregados, sin datos de clientes). */
export interface AvailabilityRow {
  business_date: string;
  capacity_total: number;
  capacity_used: number;
  capacity_remaining: number;
  is_blocked: boolean;
  can_accept: boolean;
}

/**
 * Estado de un día del calendario para la UI. Deriva de AvailabilityRow
 * (la autoridad); TypeScript solo lo traduce a etiquetas visuales.
 * "low" = puede aceptar el pedido pero quedaría poco o ningún cupo.
 */
export type DayAvailabilityStatus =
  | "available"
  | "low"
  | "full"
  | "blocked"
  | "too_soon"
  | "out_of_window";

export interface DayAvailability {
  /** "YYYY-MM-DD" (día calendario del negocio, America/Caracas). */
  date: string;
  status: DayAvailabilityStatus;
  /** true si el día acepta el pedido actual (copiado de can_accept). */
  canAccept: boolean;
  /** Cupos libres del día (independiente del pedido actual). */
  capacityRemaining: number;
  /** true si tras reservar este pedido el día quedaría en 0 cupos. */
  isLastSlot: boolean;
}

/** Proyección pública y cerrada del RPC privado de gestión. */
export interface PublicReservation {
  code: string;
  celebrationDate: string;
  status: ReservationStatus;
  customerName: string;
  guestCount: number;
  flavor: string;
  theme?: string;
  fulfillmentType: FulfillmentType;
  deliveryDetails?: string;
  createdAt: string;
  capacityPoints: 1 | 2 | 3;
  canReschedule: boolean;
  canCancel: boolean;
  rescheduleReason?: string;
  cancellationReason?: string;
}

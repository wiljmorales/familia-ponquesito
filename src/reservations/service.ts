import "server-only";
import { backendPost } from "@/lib/backend/client";
import { generateReferenceCode } from "@/lib/reference-code";
import { generateManageToken, hashManageToken } from "./token";
import type { CapacityPoints } from "./capacity";
import type {
  AvailabilityRow,
  FulfillmentType,
  INITIAL_RESERVATION_STATUSES,
  ReservationErrorCode,
  ReservationStatus,
  PublicReservation,
} from "./types";

/**
 * Servicio de reservas de Agenda Ponquesito (Reto 8). Llama a Django,
 * autoridad final sobre capacidad y reglas, y añade lo que hace Node: generar el
 * código legible FP-8-XXXX (con reintento si colisiona) y el token privado
 * de gestión (que se devuelve al llamador SOLO para construir el enlace
 * del correo; jamás se registra en logs).
 */

const RESERVATION_CODE_PREFIX = "FP-8";
const MAX_CODE_ATTEMPTS = 5;

export interface ReservationServiceDeps {
  /** Transporte inyectable solo en pruebas; en producción usa Django. */
  post?: typeof backendPost;
}

/**
 * Errores que puede devolver el servicio: los códigos de negocio de los
 * servicio más "service_unavailable" (fallo de red/configuración de Django,
 * sin detalle sensible para el cliente).
 */
export type ReservationServiceError = ReservationErrorCode | "service_unavailable";

type InitialReservationStatus = (typeof INITIAL_RESERVATION_STATUSES)[number];

export interface CreateReservationInput {
  /** "YYYY-MM-DD" (día calendario del negocio). */
  celebrationDate: string;
  /** Puntos calculados por el SERVIDOR con classifyOrder, nunca por el navegador. */
  capacityPoints: CapacityPoints;
  status: InitialReservationStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  guestCount: number;
  flavor: string;
  theme?: string;
  fulfillmentType: FulfillmentType;
  deliveryDetails?: string;
  referenceImagePath?: string;
  /** Detalle completo del pedido (respuestas + motivos de clasificación). */
  orderDetails: Record<string, unknown>;
}

export type CreateReservationResult =
  | {
      ok: true;
      reservationId: string;
      code: string;
      status: InitialReservationStatus;
      capacityTotal: number;
      capacityUsed: number;
      capacityRemaining: number;
      /**
       * Token de gestión en claro. Solo debe usarse para armar el enlace
       * privado del correo del cliente y descartarse: no guardarlo, no
       * loggearlo, no incluirlo en eventos ni en el correo de Karem.
       */
      manageToken: string;
    }
  | { ok: false; error: ReservationServiceError };

interface RpcSuccessPayload {
  ok: true;
  reservation_id: string;
  code: string;
  status: ReservationStatus;
  capacity_total?: number;
  capacity_used?: number;
  capacity_remaining?: number;
  previous_date?: string;
  new_date?: string;
  celebration_date?: string;
}

interface RpcErrorPayload {
  ok: false;
  error: ReservationErrorCode;
  capacity_remaining?: number;
}

type RpcPayload = RpcSuccessPayload | RpcErrorPayload;

interface LookupRpcSuccess {
  ok: true;
  reservation: {
    code: string;
    celebration_date: string;
    status: ReservationStatus;
    customer_name: string;
    guest_count: number;
    flavor: string;
    theme: string | null;
    fulfillment_type: FulfillmentType;
    delivery_details: string | null;
    created_at: string;
    capacity_points: 1 | 2 | 3;
    can_reschedule: boolean;
    can_cancel: boolean;
    reschedule_reason: string | null;
    cancellation_reason: string | null;
  };
}

type LookupRpcPayload =
  | LookupRpcSuccess
  | { ok: false; error: "reservation_not_found" };

export async function createReservation(
  input: CreateReservationInput,
  deps: ReservationServiceDeps = {},
): Promise<CreateReservationResult> {
  const post = deps.post ?? backendPost;
  const { token, tokenHash } = generateManageToken();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateReferenceCode(RESERVATION_CODE_PREFIX);
    let data: RpcPayload;
    try {
      data = await post<RpcPayload>("agenda-reserve", {
        celebration_date: input.celebrationDate,
        capacity_points: input.capacityPoints,
        code,
        manage_token_hash: tokenHash,
        status: input.status,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        guest_count: input.guestCount,
        flavor: input.flavor,
        theme: input.theme ?? null,
        fulfillment_type: input.fulfillmentType,
        delivery_details: input.deliveryDetails ?? null,
        reference_image_path: input.referenceImagePath ?? null,
        order_details: input.orderDetails,
      });
    } catch {
      return { ok: false, error: "service_unavailable" };
    }

    const payload = data as RpcPayload;
    if (payload.ok) {
      return {
        ok: true,
        reservationId: payload.reservation_id,
        code: payload.code,
        status: input.status,
        capacityTotal: payload.capacity_total ?? 0,
        capacityUsed: payload.capacity_used ?? 0,
        capacityRemaining: payload.capacity_remaining ?? 0,
        manageToken: token,
      };
    }

    if (payload.error !== "code_taken") {
      return { ok: false, error: payload.error };
    }
    // Colisión del código legible: el bucle genera otro y reintenta.
  }

  console.error(
    `[reservations] no se encontró código libre tras ${MAX_CODE_ATTEMPTS} intentos`,
  );
  return { ok: false, error: "code_taken" };
}

export type GetAvailabilityResult =
  | { ok: true; days: AvailabilityRow[] }
  | { ok: false; error: "service_unavailable" };

/**
 * Disponibilidad por día en [startDate, endDate]. Devuelve las filas tal
 * como las calculó PostgreSQL (solo agregados); la traducción a estados
 * visuales vive en availability.ts.
 */
export async function getAvailability(
  startDate: string,
  endDate: string,
  capacityPoints: CapacityPoints,
  deps: ReservationServiceDeps = {},
): Promise<GetAvailabilityResult> {
  let data: { ok: boolean; days?: AvailabilityRow[] };
  try {
    data = await (deps.post ?? backendPost)("agenda-availability", {
      start_date: startDate, end_date: endDate, capacity_points: capacityPoints,
    });
  } catch {
    return { ok: false, error: "service_unavailable" };
  }
  return data.ok && data.days ? { ok: true, days: data.days } : { ok: false, error: "service_unavailable" };
}

export type LookupReservationResult =
  | { ok: true; reservation: PublicReservation }
  | { ok: false; error: "reservation_not_found" | "service_unavailable" };

export async function lookupReservation(
  code: string,
  manageToken: string,
  deps: ReservationServiceDeps = {},
): Promise<LookupReservationResult> {
  let data: LookupRpcPayload;
  try {
    data = await (deps.post ?? backendPost)("agenda-lookup", { code, token_hash: hashManageToken(manageToken) });
  } catch {
    return { ok: false, error: "service_unavailable" };
  }

  const payload = data as LookupRpcPayload;
  if (!payload.ok) return payload;

  const reservation = payload.reservation;
  return {
    ok: true,
    reservation: {
      code: reservation.code,
      celebrationDate: reservation.celebration_date,
      status: reservation.status,
      customerName: reservation.customer_name,
      guestCount: reservation.guest_count,
      flavor: reservation.flavor,
      theme: reservation.theme ?? undefined,
      fulfillmentType: reservation.fulfillment_type,
      deliveryDetails: reservation.delivery_details ?? undefined,
      createdAt: reservation.created_at,
      capacityPoints: reservation.capacity_points,
      canReschedule: reservation.can_reschedule,
      canCancel: reservation.can_cancel,
      rescheduleReason: reservation.reschedule_reason ?? undefined,
      cancellationReason: reservation.cancellation_reason ?? undefined,
    },
  };
}

export type ManageReservationResult =
  | {
      ok: true;
      reservationId: string;
      code: string;
      status: ReservationStatus;
      previousDate?: string;
      newDate?: string;
      celebrationDate?: string;
    }
  | { ok: false; error: ReservationServiceError };

export async function rescheduleReservation(
  code: string,
  manageToken: string,
  newDate: string,
  deps: ReservationServiceDeps = {},
): Promise<ManageReservationResult> {
  let data: RpcPayload;
  try {
    data = await (deps.post ?? backendPost)("agenda-reschedule", {
      code, token_hash: hashManageToken(manageToken), new_date: newDate,
    });
  } catch {
    return { ok: false, error: "service_unavailable" };
  }

  return toManageResult(data as RpcPayload);
}

export async function cancelReservation(
  code: string,
  manageToken: string,
  deps: ReservationServiceDeps = {},
): Promise<ManageReservationResult> {
  let data: RpcPayload;
  try {
    data = await (deps.post ?? backendPost)("agenda-cancel", { code, token_hash: hashManageToken(manageToken) });
  } catch {
    return { ok: false, error: "service_unavailable" };
  }

  return toManageResult(data as RpcPayload);
}

function toManageResult(payload: RpcPayload): ManageReservationResult {
  if (!payload.ok) {
    return { ok: false, error: payload.error };
  }
  return {
    ok: true,
    reservationId: payload.reservation_id,
    code: payload.code,
    status: payload.status,
    previousDate: payload.previous_date,
    newDate: payload.new_date,
    celebrationDate: payload.celebration_date,
  };
}

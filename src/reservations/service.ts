import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { generateReferenceCode } from "@/lib/reference-code";
import { generateManageToken, hashManageToken } from "./token";
import type { CapacityPoints } from "./capacity";
import type {
  AvailabilityRow,
  FulfillmentType,
  INITIAL_RESERVATION_STATUSES,
  ReservationErrorCode,
  ReservationStatus,
} from "./types";

/**
 * Servicio de reservas de Agenda Ponquesito (Reto 8). Envuelve los RPC de
 * supabase/schema.sql — que son la autoridad final sobre capacidad y
 * reglas — y añade lo que solo puede hacer el servidor Node: generar el
 * código legible FP-8-XXXX (con reintento si colisiona) y el token privado
 * de gestión (que se devuelve al llamador SOLO para construir el enlace
 * del correo; jamás se registra en logs).
 */

const RESERVATION_CODE_PREFIX = "FP-8";
const MAX_CODE_ATTEMPTS = 5;

export interface ReservationServiceDeps {
  /** Inyectable para pruebas; por defecto el cliente real (service_role). */
  supabase?: SupabaseClient;
}

/**
 * Errores que puede devolver el servicio: los códigos de negocio de los
 * RPC más "service_unavailable" (fallo de red/configuración de Supabase,
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

export async function createReservation(
  input: CreateReservationInput,
  deps: ReservationServiceDeps = {},
): Promise<CreateReservationResult> {
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const { token, tokenHash } = generateManageToken();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateReferenceCode(RESERVATION_CODE_PREFIX);
    const { data, error } = await supabase.rpc("reserve_production_slot", {
      p_celebration_date: input.celebrationDate,
      p_capacity_points: input.capacityPoints,
      p_code: code,
      p_manage_token_hash: tokenHash,
      p_status: input.status,
      p_customer_name: input.customerName,
      p_customer_email: input.customerEmail,
      p_customer_phone: input.customerPhone,
      p_guest_count: input.guestCount,
      p_flavor: input.flavor,
      p_theme: input.theme ?? null,
      p_fulfillment_type: input.fulfillmentType,
      p_delivery_details: input.deliveryDetails ?? null,
      p_reference_image_path: input.referenceImagePath ?? null,
      p_order_details: input.orderDetails,
    });

    if (error || data == null) {
      console.error("[reservations] reserve_production_slot falló:", error?.message);
      return { ok: false, error: "service_unavailable" };
    }

    const payload = data as RpcPayload;
    if (payload.ok) {
      return {
        ok: true,
        reservationId: payload.reservation_id,
        code: payload.code,
        status: input.status,
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
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("get_production_availability", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_capacity_points: capacityPoints,
  });

  if (error || data == null) {
    console.error("[reservations] get_production_availability falló:", error?.message);
    return { ok: false, error: "service_unavailable" };
  }

  return { ok: true, days: data as AvailabilityRow[] };
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
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("reschedule_cake_reservation", {
    p_code: code,
    p_manage_token_hash: hashManageToken(manageToken),
    p_new_date: newDate,
  });

  if (error || data == null) {
    console.error("[reservations] reschedule_cake_reservation falló:", error?.message);
    return { ok: false, error: "service_unavailable" };
  }

  return toManageResult(data as RpcPayload);
}

export async function cancelReservation(
  code: string,
  manageToken: string,
  deps: ReservationServiceDeps = {},
): Promise<ManageReservationResult> {
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("cancel_cake_reservation", {
    p_code: code,
    p_manage_token_hash: hashManageToken(manageToken),
  });

  if (error || data == null) {
    console.error("[reservations] cancel_cake_reservation falló:", error?.message);
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

"use server";

import { headers } from "next/headers";
import { createRateLimiter } from "@/app/api/assistant/rate-limit";
import { businessTodayISO } from "@/lib/business-dates";
import {
  reservationAvailabilitySchema,
  reservationCancellationSchema,
  reservationRescheduleSchema,
} from "@/lib/validations/reservation-management";
import { monthDateRange } from "@/reservations/calendar";
import { toDayAvailability } from "@/reservations/availability";
import {
  cancelReservation,
  getAvailability,
  lookupReservation,
  rescheduleReservation,
  type GetAvailabilityResult,
  type LookupReservationResult,
  type ManageReservationResult,
} from "@/reservations/service";
import type { DayAvailability } from "@/reservations/types";

const GENERIC_ERROR =
  "No pudimos completar la operación. Verifica el enlace e inténtalo de nuevo.";
const INVALID_LINK =
  "No pudimos abrir esta reserva. El enlace puede ser incorrecto o haber vencido.";
const RATE_LIMIT =
  "Recibimos varios intentos desde tu conexión. Espera unos minutos antes de continuar.";

const modificationLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60_000 });

export interface ManageActionDeps {
  lookupReservationFn: typeof lookupReservation;
  getAvailabilityFn: (
    startDate: string,
    endDate: string,
    points: 1 | 2 | 3,
  ) => Promise<GetAvailabilityResult>;
  rescheduleReservationFn: (
    code: string,
    token: string,
    date: string,
  ) => Promise<ManageReservationResult>;
  cancelReservationFn: (
    code: string,
    token: string,
  ) => Promise<ManageReservationResult>;
  businessTodayISOFn: () => string;
  isModificationAllowedFn: () => Promise<boolean>;
}

async function defaultModificationAllowed() {
  const requestHeaders = await headers();
  const key =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    "unknown";
  return modificationLimiter(key);
}

const DEFAULT_DEPS: ManageActionDeps = {
  lookupReservationFn: lookupReservation,
  getAvailabilityFn: getAvailability,
  rescheduleReservationFn: rescheduleReservation,
  cancelReservationFn: cancelReservation,
  businessTodayISOFn: businessTodayISO,
  isModificationAllowedFn: defaultModificationAllowed,
};

function depsForTest(overrides?: Partial<ManageActionDeps>): ManageActionDeps {
  return process.env.NODE_ENV === "test"
    ? { ...DEFAULT_DEPS, ...overrides }
    : DEFAULT_DEPS;
}

export type ManageAvailabilityResult =
  | {
      ok: true;
      todayISO: string;
      currentDate: string;
      humanReview: boolean;
      days: DayAvailability[];
    }
  | { ok: false; message: string };

export async function fetchRescheduleAvailability(
  raw: unknown,
  testDeps?: Partial<ManageActionDeps>,
): Promise<ManageAvailabilityResult> {
  const parsed = reservationAvailabilitySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: INVALID_LINK };

  const deps = depsForTest(testDeps);
  const lookup = await deps.lookupReservationFn(parsed.data.code, parsed.data.token);
  if (!lookup.ok) return { ok: false, message: safeLookupMessage(lookup) };
  if (!lookup.reservation.canReschedule) {
    return { ok: false, message: reasonMessage(lookup.reservation.rescheduleReason) };
  }

  const { startISO, endISO } = monthDateRange(parsed.data.monthISO);
  const availability = await deps.getAvailabilityFn(
    startISO,
    endISO,
    lookup.reservation.capacityPoints,
  );
  if (!availability.ok) return { ok: false, message: GENERIC_ERROR };

  const todayISO = deps.businessTodayISOFn();
  return {
    ok: true,
    todayISO,
    currentDate: lookup.reservation.celebrationDate,
    humanReview: lookup.reservation.status === "human_review",
    days: availability.days.map((row) =>
      toDayAvailability(row, {
        todayISO,
        points: lookup.reservation.capacityPoints,
      }),
    ),
  };
}

export type ReservationMutationResult =
  | { ok: true; message: string; celebrationDate: string; status: string }
  | { ok: false; message: string };

export async function rescheduleManagedReservation(
  raw: unknown,
  testDeps?: Partial<ManageActionDeps>,
): Promise<ReservationMutationResult> {
  const parsed = reservationRescheduleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Confirma una nueva fecha válida." };
  const deps = depsForTest(testDeps);
  if (!(await deps.isModificationAllowedFn())) return { ok: false, message: RATE_LIMIT };

  const result = await deps.rescheduleReservationFn(
    parsed.data.code,
    parsed.data.token,
    parsed.data.newDate,
  );
  if (!result.ok) return { ok: false, message: reasonMessage(result.error) };

  return {
    ok: true,
    message:
      result.status === "human_review"
        ? "Actualizamos tu fecha preferida. Sigue en revisión y aún no está reservada."
        : "Tu reserva fue reprogramada correctamente.",
    celebrationDate: result.newDate ?? parsed.data.newDate,
    status: result.status,
  };
}

export async function cancelManagedReservation(
  raw: unknown,
  testDeps?: Partial<ManageActionDeps>,
): Promise<ReservationMutationResult> {
  const parsed = reservationCancellationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Confirma expresamente la cancelación." };
  const deps = depsForTest(testDeps);
  if (!(await deps.isModificationAllowedFn())) return { ok: false, message: RATE_LIMIT };

  const result = await deps.cancelReservationFn(parsed.data.code, parsed.data.token);
  if (!result.ok) return { ok: false, message: reasonMessage(result.error) };

  return {
    ok: true,
    message: "Tu solicitud fue cancelada. Esta acción no puede deshacerse desde la aplicación.",
    celebrationDate: result.celebrationDate ?? "",
    status: "cancelled",
  };
}

function safeLookupMessage(result: Extract<LookupReservationResult, { ok: false }>) {
  return result.error === "reservation_not_found" ? INVALID_LINK : GENERIC_ERROR;
}

function reasonMessage(reason?: string): string {
  const messages: Record<string, string> = {
    reservation_not_found: INVALID_LINK,
    same_date: "Selecciona una fecha diferente a la actual.",
    capacity_unavailable: "Esa fecha ya no tiene capacidad suficiente. Elige otra.",
    date_blocked: "Ese día no estaremos horneando. Elige otra fecha.",
    too_soon: "Necesitamos al menos tres días de anticipación.",
    out_of_window: "La fecha está fuera de nuestra ventana de 60 días.",
    change_window_closed: "La preparación está demasiado cerca y ya no admite cambios.",
    cancellation_window_closed:
      "La preparación está demasiado cerca y ya no puede cancelarse desde la aplicación.",
    status_not_modifiable: "El estado actual de la solicitud no permite reprogramarla.",
    status_not_cancellable: "El estado actual de la solicitud no permite cancelarla.",
    already_cancelled: "Esta solicitud ya fue cancelada.",
    service_unavailable: GENERIC_ERROR,
  };
  return (reason && messages[reason]) || GENERIC_ERROR;
}

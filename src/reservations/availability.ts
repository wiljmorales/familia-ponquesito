import { addDaysISO, daysBetweenISO } from "@/lib/business-dates";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import {
  BOOKING_WINDOW_DAYS,
  LOW_CAPACITY_REMAINING_AFTER_BOOKING,
  type CapacityPoints,
} from "./capacity";
import type { AvailabilityRow, DayAvailability, DayAvailabilityStatus } from "./types";

/**
 * Traducción de las filas de get_production_availability (la autoridad:
 * PostgreSQL ya decidió can_accept con capacidad, bloqueos y ventana) a los
 * estados visuales del calendario. Aquí NO se recalcula capacidad; solo se
 * distingue POR QUÉ un día no acepta (bloqueado / muy pronto / fuera de
 * ventana / lleno) y se matiza el "sí acepta" (disponible / pocos cupos).
 */

export interface AvailabilityContext {
  /** "YYYY-MM-DD" de hoy en la zona horaria del negocio. */
  todayISO: string;
  /** Puntos del pedido actual (los mismos pasados al RPC). */
  points: CapacityPoints;
}

export function toDayAvailability(
  row: AvailabilityRow,
  ctx: AvailabilityContext,
): DayAvailability {
  const status = deriveStatus(row, ctx);
  return {
    date: row.business_date,
    status,
    canAccept: row.can_accept,
    capacityRemaining: row.capacity_remaining,
    isLastSlot: row.can_accept && row.capacity_remaining === ctx.points,
  };
}

function deriveStatus(row: AvailabilityRow, ctx: AvailabilityContext): DayAvailabilityStatus {
  if (row.is_blocked) return "blocked";
  if (row.business_date < addDaysISO(ctx.todayISO, MIN_LEAD_DAYS)) return "too_soon";
  if (row.business_date > addDaysISO(ctx.todayISO, BOOKING_WINDOW_DAYS)) {
    return "out_of_window";
  }
  if (!row.can_accept) return "full";
  if (row.capacity_remaining - ctx.points <= LOW_CAPACITY_REMAINING_AFTER_BOOKING) {
    return "low";
  }
  return "available";
}

/** Máximo de fechas alternativas que se ofrecen cuando un día no acepta. */
export const MAX_NEARBY_ALTERNATIVES = 3;

/**
 * Fechas alternativas cercanas a la solicitada: días que sí aceptan el
 * pedido, ordenados por cercanía a la fecha pedida; en empate de distancia
 * gana la fecha posterior (mejor más margen de producción que menos). Debe
 * llamarse con disponibilidad recién consultada, no con datos viejos del
 * navegador.
 */
export function findNearbyAlternatives(
  days: DayAvailability[],
  requestedDateISO: string,
  max: number = MAX_NEARBY_ALTERNATIVES,
): DayAvailability[] {
  return days
    .filter((day) => day.canAccept && day.date !== requestedDateISO)
    .map((day) => ({ day, distance: daysBetweenISO(requestedDateISO, day.date) }))
    .sort((a, b) => {
      const byProximity = Math.abs(a.distance) - Math.abs(b.distance);
      if (byProximity !== 0) return byProximity;
      return b.distance - a.distance;
    })
    .slice(0, max)
    .map(({ day }) => day);
}

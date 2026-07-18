import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import { businessTodayISO, daysBetweenISO } from "@/lib/business-dates";

export type LeadPriority = "not_viable" | "urgent" | "high" | "normal";

/** Última fecha clasificada como "high" antes de pasar a "normal". */
const HIGH_PRIORITY_MAX_DAYS = 10;

/**
 * "YYYY-MM-DD" del día calendario actual en la zona horaria del negocio.
 * Alias histórico: el reporte semanal (Reto 6) la importa con este nombre;
 * la implementación vive en src/lib/business-dates.ts desde el Reto 8.
 */
export const businessTodayString = businessTodayISO;

/**
 * Clasifica la prioridad de un lead según su anticipación real (días entre
 * hoy, en la zona horaria del negocio, y la fecha de celebración/evento).
 * `now` es inyectable para pruebas deterministas; por defecto usa la hora
 * real del sistema.
 */
export function classifyLeadPriority(
  celebrationDate: string,
  now: Date = new Date(),
): LeadPriority {
  const daysUntil = daysBetweenISO(businessTodayString(now), celebrationDate);

  if (daysUntil < MIN_LEAD_DAYS) return "not_viable";
  if (daysUntil <= MIN_LEAD_DAYS + 1) return "urgent";
  if (daysUntil <= HIGH_PRIORITY_MAX_DAYS) return "high";
  return "normal";
}

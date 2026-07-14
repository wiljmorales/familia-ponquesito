import { MIN_LEAD_DAYS } from "@/lib/constants/business";

export type LeadPriority = "not_viable" | "urgent" | "high" | "normal";

/**
 * Zona horaria del negocio (Barquisimeto, Venezuela). La clasificación se
 * calcula sobre la fecha calendario en esta zona, no en la del servidor:
 * en Vercel el runtime corre en UTC, y Caracas es UTC-4 sin horario de
 * verano, así que usar `new Date().getDate()` del servidor movería el
 * límite de "hoy" varias horas antes de la medianoche real de Caracas.
 */
const BUSINESS_TIMEZONE = "America/Caracas";

/** Última fecha clasificada como "high" antes de pasar a "normal". */
const HIGH_PRIORITY_MAX_DAYS = 10;

/** "YYYY-MM-DD" del día calendario actual en la zona horaria del negocio. */
function businessTodayString(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Diferencia en días calendario entre dos "YYYY-MM-DD" (b - a). */
function daysBetween(a: string, b: string): number {
  const [aYear, aMonth, aDay] = a.split("-").map(Number);
  const [bYear, bMonth, bDay] = b.split("-").map(Number);
  const aUtc = Date.UTC(aYear, aMonth - 1, aDay);
  const bUtc = Date.UTC(bYear, bMonth - 1, bDay);
  return Math.round((bUtc - aUtc) / (24 * 60 * 60 * 1000));
}

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
  const daysUntil = daysBetween(businessTodayString(now), celebrationDate);

  if (daysUntil < MIN_LEAD_DAYS) return "not_viable";
  if (daysUntil <= MIN_LEAD_DAYS + 1) return "urgent";
  if (daysUntil <= HIGH_PRIORITY_MAX_DAYS) return "high";
  return "normal";
}

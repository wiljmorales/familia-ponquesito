/**
 * Utilidades compartidas de fechas del negocio. Trabajan siempre con días
 * calendario "YYYY-MM-DD" anclados a la zona horaria del negocio
 * (America/Caracas): ninguna decisión (anticipación, vencimiento,
 * disponibilidad) debe depender del huso horario del navegador ni del
 * servidor (Vercel corre en UTC). Nacieron en el prototipo del Reto 5 y se
 * promovieron aquí al ser necesarias también por los Retos 4, 7 y 8.
 */

const BUSINESS_TIMEZONE = "America/Caracas";

/** "YYYY-MM-DD" del día calendario actual en la zona horaria del negocio. */
export function businessTodayISO(now: Date = new Date()): string {
  // en-CA produce exactamente "YYYY-MM-DD".
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Suma días calendario a un "YYYY-MM-DD" (Date.UTC maneja el overflow de mes/año). */
export function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Diferencia en días calendario entre dos "YYYY-MM-DD" (to - from). */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const [fromYear, fromMonth, fromDay] = fromISO.split("-").map(Number);
  const [toYear, toMonth, toDay] = toISO.split("-").map(Number);
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

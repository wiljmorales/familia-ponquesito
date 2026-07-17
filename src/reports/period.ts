import { businessTodayString } from "@/leads/classify";
import type { ReportPeriod } from "./types";

/**
 * Caracas es UTC-4 fijo (sin horario de verano), así que la medianoche de
 * un día calendario del negocio siempre es el mismo instante UTC: las
 * 04:00. Se usa para traducir los límites del periodo (días calendario) a
 * filtros exactos sobre created_at (timestamptz, almacenado en UTC).
 */
const CARACAS_UTC_OFFSET_HOURS = 4;

/** Suma días calendario a un "YYYY-MM-DD" (días negativos restan). */
export function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Día de la semana ISO de un "YYYY-MM-DD": 1 = lunes … 7 = domingo. */
function isoWeekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Instante UTC (ISO) de la medianoche de Caracas del día indicado. */
export function caracasMidnightUtc(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, CARACAS_UTC_OFFSET_HOURS)).toISOString();
}

/**
 * Última semana completa lunes–domingo en el calendario de Caracas,
 * estrictamente anterior a hoy. El cron del lunes ~12:00 UTC (~8:00 a. m.
 * en Caracas) reporta la semana que terminó el domingo anterior; si el
 * disparo se corre unas horas (Vercel Hobby no garantiza el minuto), el
 * periodo calculado no cambia mientras siga siendo el mismo día calendario
 * en Caracas.
 */
export function lastCompleteWeekPeriod(now: Date = new Date()): ReportPeriod {
  const today = businessTodayString(now);
  const currentWeekMonday = addDaysToDateString(today, -(isoWeekday(today) - 1));
  const start = addDaysToDateString(currentWeekMonday, -7);
  const end = addDaysToDateString(currentWeekMonday, -1);

  return {
    start,
    end,
    startUtc: caracasMidnightUtc(start),
    endExclusiveUtc: caracasMidnightUtc(currentWeekMonday),
    timezone: "America/Caracas",
  };
}

/**
 * Ventana de "celebraciones próximas": de hoy a dentro de 7 días, ambos
 * inclusive, en el calendario de Caracas. Se aplica sobre TODOS los leads
 * (celebration_date), no solo los registrados durante el periodo semanal:
 * una celebración cercana importa aunque el lead sea antiguo.
 */
export function upcomingCelebrationsWindow(now: Date = new Date()): { from: string; to: string } {
  const today = businessTodayString(now);
  return { from: today, to: addDaysToDateString(today, 7) };
}

/**
 * Utilidades puras del calendario mensual de Agenda Ponquesito (Reto 8).
 * Trabajan sobre meses "YYYY-MM" y días "YYYY-MM-DD" como texto (mismo
 * criterio de src/lib/business-dates.ts: días calendario del negocio, sin
 * huso horario del navegador). La disponibilidad de cada día viene del
 * backend; aquí solo se arma la cuadrícula.
 */

/** "YYYY-MM" del mes al que pertenece un día "YYYY-MM-DD". */
export function monthOfISO(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** Suma meses calendario a un "YYYY-MM". */
export function addMonthsISO(monthISO: string, delta: number): string {
  const [year, month] = monthISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Primer y último día ("YYYY-MM-DD") de un mes "YYYY-MM". */
export function monthDateRange(monthISO: string): { startISO: string; endISO: string } {
  const [year, month] = monthISO.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startISO: `${monthISO}-01`,
    endISO: `${monthISO}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** "agosto de 2026" (etiqueta del encabezado del calendario). */
export function monthLabelEs(monthISO: string): string {
  const [year, month] = monthISO.split("-").map(Number);
  return new Intl.DateTimeFormat("es-VE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * Cuadrícula del mes en semanas que empiezan en lunes. Cada celda es el
 * "YYYY-MM-DD" del día o null (relleno antes del 1.º / después del último).
 */
export function buildMonthGrid(monthISO: string): (string | null)[][] {
  const [year, month] = monthISO.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay(): 0 = domingo; desplazamiento para semana lunes-domingo.
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push(`${monthISO}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * Formatea una fecha "YYYY-MM-DD" (sin hora, tal como se guarda en
 * celebration_date/event_date) a texto en español. Se construye con
 * Date.UTC + timeZone: "UTC" a propósito: la fecha ya es un día calendario
 * puro, así que fijar UTC evita que el huso horario del servidor la
 * corra un día para adelante o atrás al formatearla.
 */
export function formatDateEs(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

import type { LeadPriority } from "@/leads/classify";
import type { LeadSourceType } from "@/leads/types";
import type { SummarySource, WeeklyReportMetrics } from "@/reports/types";
import { escapeHtml } from "../escape";
import { formatDateEs } from "../format-date";
import type { EmailContent } from "./types";

export interface WeeklyReportEmailInput {
  metrics: WeeklyReportMetrics;
  summary: string;
  summarySource: SummarySource;
}

const SOURCE_LABEL: Record<LeadSourceType, string> = {
  cake_request: "Formulario de la landing",
  cake_design: "Juego Crea tu torta",
};

const PRIORITY_LABEL: Record<LeadPriority, string> = {
  not_viable: "No viables",
  urgent: "Urgentes",
  high: "Prioridad alta",
  normal: "Normales",
};

const SUMMARY_SOURCE_NOTE: Record<SummarySource, string> = {
  gemini: "Resumen redactado con IA (Gemini) a partir de las métricas.",
  fallback: "Resumen automático generado sin IA a partir de las métricas.",
};

function formatRate(rate: number | null): string {
  if (rate === null) return "Sin envíos en el periodo";
  return `${Math.round(rate * 100)} %`;
}

/**
 * Correo "Pulso Ponquesito": solo métricas agregadas y el resumen
 * ejecutivo — nunca nombres, correos ni teléfonos de clientes. El resumen
 * se escapa porque proviene de un modelo (texto no confiable para HTML).
 * El asunto solo usa fechas generadas por el servidor.
 */
export function buildWeeklyReportEmail(input: WeeklyReportEmailInput): EmailContent {
  const { metrics, summary, summarySource } = input;
  const startLabel = formatDateEs(metrics.period.start);
  const endLabel = formatDateEs(metrics.period.end);

  const subject = `Pulso Ponquesito — semana del ${startLabel} al ${endLabel}`;

  const sourceLines = (Object.keys(SOURCE_LABEL) as LeadSourceType[]).map(
    (source) => `${SOURCE_LABEL[source]}: ${metrics.leads.bySource[source]}`,
  );

  // not_viable es inalcanzable por el flujo normal (validación de fecha en
  // ambos formularios); solo se muestra si algún dato manipulado la produjo.
  const priorityKeys = (Object.keys(PRIORITY_LABEL) as LeadPriority[]).filter(
    (priority) => priority !== "not_viable" || metrics.leads.byPriority[priority] > 0,
  );
  const priorityLines = priorityKeys.map(
    (priority) => `${PRIORITY_LABEL[priority]}: ${metrics.leads.byPriority[priority]}`,
  );

  const metricLines = [
    `Solicitudes nuevas en la semana: ${metrics.leads.newInPeriod}`,
    `Solicitudes acumuladas: ${metrics.leads.totalAccumulated}`,
    ...sourceLines,
    ...priorityLines,
    `Celebraciones en los próximos 7 días: ${metrics.upcomingCelebrations.next7Days}`,
    `Eventos de automatización con éxito: ${metrics.automation.eventsInPeriod.success}`,
    `Eventos de automatización con error: ${metrics.automation.eventsInPeriod.error}`,
    `Correos automáticos: ${metrics.automation.emails.sent} de ${metrics.automation.emails.attempted} aceptados por el servidor de correo`,
    `Tasa de envío: ${formatRate(metrics.automation.emails.sendSuccessRate)}`,
  ];

  const alertsHtml =
    metrics.alerts.length > 0
      ? `<p><strong>Para tener en cuenta:</strong></p>
  <ul>${metrics.alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join("")}</ul>`
      : "";

  const html = `
<div style="font-family: sans-serif; color: #4b2e2b; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  <h1 style="font-size: 20px;">Pulso Ponquesito</h1>
  <p>Semana del ${startLabel} al ${endLabel}.</p>
  <p style="background: #fdf3e7; border-left: 4px solid #c96f4a; padding: 8px 12px;">
    <strong>Nota:</strong> ${escapeHtml(metrics.dataDisclaimer)}
  </p>
  <p><strong>Resumen ejecutivo</strong></p>
  <p>${escapeHtml(summary)}</p>
  <p style="font-size: 12px; color: #8a6f5f;">${SUMMARY_SOURCE_NOTE[summarySource]}</p>
  <p><strong>Métricas de la semana</strong></p>
  <ul>${metricLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
  ${alertsHtml}
  <p style="font-size: 12px; color: #8a6f5f;">
    "Aceptado por el servidor de correo" significa que el envío salió con
    éxito; no es posible confirmar entrega ni lectura.
  </p>
</div>
`.trim();

  const textLines = [
    "Pulso Ponquesito",
    `Semana del ${startLabel} al ${endLabel}.`,
    "",
    `Nota: ${metrics.dataDisclaimer}`,
    "",
    "Resumen ejecutivo:",
    summary,
    `(${SUMMARY_SOURCE_NOTE[summarySource]})`,
    "",
    "Métricas de la semana:",
    ...metricLines.map((line) => `- ${line}`),
  ];

  if (metrics.alerts.length > 0) {
    textLines.push("", "Para tener en cuenta:", ...metrics.alerts.map((alert) => `- ${alert}`));
  }

  textLines.push(
    "",
    '"Aceptado por el servidor de correo" significa que el envío salió con éxito; no es posible confirmar entrega ni lectura.',
  );

  return { subject, html, text: textLines.join("\n") };
}

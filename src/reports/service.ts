import "server-only";
import { backendPost } from "@/lib/backend/client";
import { defaultEmailClient, type EmailClient, type SendEmailResult } from "@/email/client";
import { buildWeeklyReportEmail } from "@/email/templates/weekly-report";
import { computeWeeklyMetrics } from "./metrics";
import { lastCompleteWeekPeriod, upcomingCelebrationsWindow } from "./period";
import { buildFallbackSummary, defaultSummaryGenerator, type SummaryGenerator } from "./summary";
import type {
  AutomationEventMetricsRow,
  LeadMetricsRow,
  ReportPeriod,
  WeeklyReportMetrics,
  WeeklyReportTrigger,
} from "./types";

export interface GenerateWeeklyReportDeps {
  /** Inyectable para pruebas; por defecto la API interna de Django. */
  post?: typeof backendPost;
  /** Inyectable para pruebas; por defecto SMTP (Nodemailer) o el stub de desarrollo. */
  emailClient?: EmailClient;
  /** Inyectable para pruebas; por defecto Gemini con fallback determinístico. */
  summaryGenerator?: SummaryGenerator;
  /** Inyectable para pruebas; por defecto process.env.KAREM_NOTIFICATION_EMAIL. */
  karemEmail?: string;
  /** Inyectable para pruebas deterministas; por defecto la hora real. */
  now?: Date;
}

export type WeeklyReportOutcome = "sent" | "skipped_duplicate" | "email_error" | "data_error";

export interface GenerateWeeklyReportResult {
  outcome: WeeklyReportOutcome;
  /** null cuando la corrida se omitió o falló antes de reservar la fila. */
  reportId: string | null;
  period: { start: string; end: string };
  error?: string;
}

/**
 * Enmascara el destinatario para guardarlo/mostrarlo sin exponer el correo
 * completo (ej. "karem@gmail.com" → "k•••@gmail.com"). El valor real solo
 * vive en la variable de entorno.
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "•••";
  return `${email[0]}•••@${email.slice(atIndex + 1)}`;
}

/** Un solo reintento ante un fallo transitorio, igual que processLead (Reto 4). */
async function sendWithRetry(
  emailClient: EmailClient,
  message: { to: string; subject: string; html: string; text: string },
): Promise<SendEmailResult> {
  const first = await emailClient.send(message);
  if (first.ok) return first;
  return emailClient.send(message);
}

/**
 * Genera y envía el reporte semanal "Pulso Ponquesito". Nunca lanza: todo
 * resultado (éxito, duplicado omitido, error de datos o de correo) queda
 * en la fila de weekly_reports cuando existe, y siempre se devuelve un
 * resultado descriptivo para quien llama (el route handler del cron).
 *
 * Flujo: reservar la fila 'processing' (idempotencia del cron por índice
 * único parcial) → consultar agregados → métricas → resumen (Gemini o
 * fallback; nunca detiene el reporte) → correo → actualizar la fila.
 */
export async function generateWeeklyReport(
  trigger: WeeklyReportTrigger,
  deps: GenerateWeeklyReportDeps = {},
): Promise<GenerateWeeklyReportResult> {
  const now = deps.now ?? new Date();
  const period = lastCompleteWeekPeriod(now);
  const periodLabel = { start: period.start, end: period.end };

  const post = deps.post ?? backendPost;

  // Reserva del periodo ANTES de generar o enviar nada: para 'scheduled',
  // el índice único parcial garantiza una sola corrida por periodo; un
  // segundo disparo del cron recibe 23505 y se omite sin enviar correo.
  let inserted: { ok: boolean; id?: string; error?: string };
  try {
    inserted = await post("report-reserve", {
      period_start: period.start,
      period_end: period.end,
      trigger_type: trigger,
    });
  } catch {
    return { outcome: "data_error", reportId: null, period: periodLabel, error: "La base de datos no está disponible." };
  }

  if (!inserted.ok || !inserted.id) {
    if (trigger === "scheduled" && inserted.error === "duplicate") {
      return { outcome: "skipped_duplicate", reportId: null, period: periodLabel };
    }
    console.error("[reports] fallo al reservar la fila del reporte");
    return {
      outcome: "data_error",
      reportId: null,
      period: periodLabel,
      error: "No se pudo registrar la ejecución del reporte.",
    };
  }

  const reportId = inserted.id;

  try {
    const dataResult = await fetchReportData(post, period, now);
    if (!dataResult.ok) {
      await updateReport(post, reportId, {
        status: "data_error",
        error_message: dataResult.error,
      });
      return { outcome: "data_error", reportId, period: periodLabel, error: dataResult.error };
    }

    const metrics = computeWeeklyMetrics({
      period,
      leadsInPeriod: dataResult.leadsInPeriod,
      totalLeads: dataResult.totalLeads,
      upcomingCelebrations: dataResult.upcomingCelebrations,
      eventsInPeriod: dataResult.eventsInPeriod,
    });

    const summaryResult = await generateSummarySafely(
      deps.summaryGenerator ?? defaultSummaryGenerator(),
      metrics,
    );

    const karemEmail = deps.karemEmail ?? process.env.KAREM_NOTIFICATION_EMAIL;
    if (!karemEmail) {
      const message =
        "Falta configurar KAREM_NOTIFICATION_EMAIL: no hay destinatario para el reporte semanal.";
      await updateReport(post, reportId, {
        metrics,
        summary: summaryResult.summary,
        summary_source: summaryResult.source,
        status: "email_error",
        error_message: message,
      });
      return { outcome: "email_error", reportId, period: periodLabel, error: message };
    }

    const emailClient = deps.emailClient ?? defaultEmailClient();
    const email = buildWeeklyReportEmail({
      metrics,
      summary: summaryResult.summary,
      summarySource: summaryResult.source,
    });

    const sendResult = await sendWithRetry(emailClient, {
      to: karemEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    await updateReport(post, reportId, {
      metrics,
      summary: summaryResult.summary,
      summary_source: summaryResult.source,
      recipient_masked: maskEmail(karemEmail),
      status: sendResult.ok ? "sent" : "email_error",
      sent_at: sendResult.ok ? new Date().toISOString() : null,
      error_message: sendResult.ok ? null : (sendResult.error ?? "Fallo desconocido al enviar."),
    });

    return sendResult.ok
      ? { outcome: "sent", reportId, period: periodLabel }
      : { outcome: "email_error", reportId, period: periodLabel, error: sendResult.error };
  } catch {
    // Cinturón de seguridad: ningún fallo inesperado debe dejar la fila en
    // 'processing' para siempre ni propagarse al route handler.
    const message = "Fallo inesperado al generar el reporte.";
    console.error("[reports] fallo inesperado generando el reporte");
    await updateReport(post, reportId, { status: "data_error", error_message: message });
    return { outcome: "data_error", reportId, period: periodLabel, error: message };
  }
}

/**
 * El resumen jamás detiene el reporte: si el generador (incluso uno
 * inyectado) lanza, se degrada al fallback determinístico.
 */
async function generateSummarySafely(
  generator: SummaryGenerator,
  metrics: WeeklyReportMetrics,
): Promise<{ summary: string; source: "gemini" | "fallback" }> {
  try {
    return await generator(metrics);
  } catch {
    console.error("[reports] el generador de resumen lanzó; se usa el fallback");
    return { summary: buildFallbackSummary(metrics), source: "fallback" };
  }
}

type FetchReportDataResult =
  | {
      ok: true;
      leadsInPeriod: LeadMetricsRow[];
      totalLeads: number;
      upcomingCelebrations: number;
      eventsInPeriod: AutomationEventMetricsRow[];
    }
  | { ok: false; error: string };

/**
 * Consultas del reporte. Privacidad desde la consulta: de `leads` solo se
 * seleccionan columnas no personales (nunca customer_name, customer_email,
 * customer_whatsapp ni normalized_payload) y de los eventos nunca
 * error_message ni metadata. Los conteos (total y celebraciones próximas)
 * ni siquiera traen filas: count con head.
 */
async function fetchReportData(
  post: typeof backendPost,
  period: ReportPeriod,
  now: Date,
): Promise<FetchReportDataResult> {
  const window = upcomingCelebrationsWindow(now);
  const result = await post<{
    ok: boolean; leads_in_period: LeadMetricsRow[]; total_leads: number;
    upcoming_celebrations: number; events_in_period: AutomationEventMetricsRow[];
  }>("report-data", {
    start_utc: period.startUtc, end_exclusive_utc: period.endExclusiveUtc,
    upcoming_from: window.from, upcoming_to: window.to,
  });
  if (!result.ok) return { ok: false, error: "No se pudieron consultar los datos del reporte." };

  return {
    ok: true,
    leadsInPeriod: result.leads_in_period,
    totalLeads: result.total_leads,
    upcomingCelebrations: result.upcoming_celebrations,
    eventsInPeriod: result.events_in_period,
  };
}

async function updateReport(
  post: typeof backendPost,
  reportId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const result = await post<{ ok: boolean }>("report-update", { id: reportId, ...values });
  if (!result.ok) {
    console.error("[reports] fallo al actualizar la fila del reporte");
  }
}

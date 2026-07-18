import {
  CalendarClock,
  ClipboardCheck,
  Database,
  Mail,
  MoveDown,
  MoveRight,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { formatDateEs } from "@/email/format-date";
import type {
  SummarySource,
  WeeklyReportMetrics,
  WeeklyReportStatus,
  WeeklyReportTrigger,
} from "@/reports/types";

/**
 * Piezas de presentación de /reporte-semanal. Todo es server-rendered y
 * solo recibe datos ya seguros: filas de weekly_reports sin
 * recipient_masked, sin error_message y sin identificadores internos.
 * Los estados fallidos se muestran con mensajes genéricos — el detalle
 * técnico jamás llega al navegador.
 */

export interface LatestReportRow {
  period_start: string;
  period_end: string;
  status: WeeklyReportStatus;
  trigger_type: WeeklyReportTrigger;
  summary: string | null;
  summary_source: SummarySource | null;
  metrics: WeeklyReportMetrics | null;
  generated_at: string;
}

export interface HistoryRow {
  period_start: string;
  period_end: string;
  trigger_type: WeeklyReportTrigger;
  status: WeeklyReportStatus;
  generated_at: string;
}

const STATUS_LABEL: Record<WeeklyReportStatus, string> = {
  processing: "En proceso",
  sent: "Enviado",
  email_error: "No se pudo completar el envío",
  data_error: "No se pudo generar el reporte",
};

const TRIGGER_LABEL: Record<WeeklyReportTrigger, string> = {
  scheduled: "Programada",
  manual: "Manual",
};

const SUMMARY_SOURCE_LABEL: Record<SummarySource, string> = {
  gemini: "Resumen redactado con IA (Gemini)",
  fallback: "Resumen automático (sin IA)",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgentes",
  high: "Prioridad alta",
  normal: "Normales",
  not_viable: "No viables",
};

/** Fecha y hora legibles en la zona horaria del negocio. */
export function formatDateTimeVe(iso: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Caracas",
  }).format(new Date(iso));
}

function periodLabel(start: string, end: string): string {
  return `${formatDateEs(start)} al ${formatDateEs(end)}`;
}

export function StatusBadge({ status }: { status: WeeklyReportStatus }) {
  // El estado se comunica siempre con texto, nunca solo con color.
  const tone =
    status === "sent"
      ? "border-terracotta/40 bg-terracotta/10 text-terracotta-dark"
      : status === "processing"
        ? "border-gold/50 bg-gold/10 text-cocoa"
        : "border-cocoa/30 bg-cocoa/5 text-cocoa";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const FLOW_STEPS = [
  {
    icon: Database,
    title: "Supabase",
    detail: "Se consulta la actividad registrada: solicitudes y automatizaciones.",
  },
  {
    icon: SlidersHorizontal,
    title: "Transformación",
    detail: "Los registros se convierten en métricas agregadas, sin datos personales.",
  },
  {
    icon: Sparkles,
    title: "Resumen ejecutivo",
    detail: "IA cuando está disponible; un resumen automático si no lo está.",
  },
  {
    icon: Mail,
    title: "Correo",
    detail: "El reporte llega al correo configurado del negocio.",
  },
  {
    icon: ClipboardCheck,
    title: "Registro",
    detail: "Cada ejecución queda guardada, con su resultado.",
  },
];

export function FlowDiagram() {
  return (
    <ol className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
      {FLOW_STEPS.map((step, index) => {
        const Icon = step.icon;
        return (
          <li key={step.title} className="flex flex-1 flex-col gap-2 lg:flex-row lg:items-stretch">
            <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-border-soft bg-cream-light p-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
                <Icon className="size-5" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-cocoa">
                <span className="mr-1 text-terracotta">{index + 1}.</span>
                {step.title}
              </p>
              <p className="text-xs leading-relaxed text-text-secondary">{step.detail}</p>
            </div>
            {index < FLOW_STEPS.length - 1 && (
              <span
                className="flex items-center justify-center text-terracotta/60"
                aria-hidden
              >
                <MoveDown className="size-4 lg:hidden" />
                <MoveRight className="hidden size-4 lg:block" />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function AutomationStatus() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex items-start gap-3 rounded-2xl border border-border-soft bg-cream-light p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-cocoa">Todos los lunes</p>
          <p className="text-xs leading-relaxed text-text-secondary">
            Entre 8:00 y 8:59 a. m., hora de Venezuela (la plataforma dispara
            el cron dentro de esa hora, no en un minuto exacto).
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-border-soft bg-cream-light p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
          <Mail className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-cocoa">De Supabase al correo del negocio</p>
          <p className="text-xs leading-relaxed text-text-secondary">
            Se reporta la actividad registrada en Supabase y el resultado
            llega al correo configurado del negocio.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border-soft bg-cream-light p-4">
      <p className="font-serif text-2xl text-cocoa">{value}</p>
      <p className="mt-1 text-xs leading-snug text-text-secondary">{label}</p>
    </div>
  );
}

export function LatestReport({ report }: { report: LatestReportRow }) {
  const metrics = report.metrics;
  const emails = metrics?.automation.emails;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={report.status} />
        <span className="rounded-full border border-border-soft bg-cream-light px-3 py-1 text-xs font-semibold text-text-secondary">
          Ejecución {TRIGGER_LABEL[report.trigger_type].toLowerCase()}
        </span>
        {report.summary_source && (
          <span className="rounded-full border border-border-soft bg-cream-light px-3 py-1 text-xs font-semibold text-text-secondary">
            {SUMMARY_SOURCE_LABEL[report.summary_source]}
          </span>
        )}
      </div>

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="font-semibold text-cocoa">Periodo:</dt>
          <dd className="text-text-secondary">{periodLabel(report.period_start, report.period_end)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold text-cocoa">Generado:</dt>
          <dd className="text-text-secondary">{formatDateTimeVe(report.generated_at)}</dd>
        </div>
      </dl>

      {report.summary ? (
        <blockquote className="rounded-2xl border-l-4 border-terracotta bg-cream-light p-5">
          <p className="text-base leading-relaxed text-text-primary">{report.summary}</p>
        </blockquote>
      ) : (
        <p className="rounded-2xl border border-border-soft bg-cream-light p-5 text-sm text-text-secondary">
          Esta ejecución no llegó a producir un resumen.
        </p>
      )}

      {metrics ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Solicitudes nuevas en la semana" value={String(metrics.leads.newInPeriod)} />
            <Stat label="Solicitudes acumuladas" value={String(metrics.leads.totalAccumulated)} />
            <Stat
              label="Celebraciones en los próximos 7 días"
              value={String(metrics.upcomingCelebrations.next7Days)}
            />
            <Stat
              label="Correos aceptados por el servidor de correo"
              value={`${metrics.automation.emails.sent} de ${metrics.automation.emails.attempted}`}
            />
            <Stat label="Fallos de envío" value={String(metrics.automation.emails.failed)} />
            <Stat
              label="Tasa de envío"
              value={
                emails && emails.sendSuccessRate !== null
                  ? `${Math.round(emails.sendSuccessRate * 100)} %`
                  : "Sin envíos en el periodo"
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border-soft bg-cream-light p-4">
              <p className="text-sm font-semibold text-cocoa">De dónde llegaron</p>
              <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                <li>Formulario de la landing: {metrics.leads.bySource.cake_request}</li>
                <li>Juego Crea tu torta: {metrics.leads.bySource.cake_design}</li>
                {/* ?? 0: reportes previos al Reto 7 no traen esta fuente en su jsonb. */}
                <li>Agente de Atención: {metrics.leads.bySource.agent_message ?? 0}</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border-soft bg-cream-light p-4">
              <p className="text-sm font-semibold text-cocoa">Nivel de atención</p>
              <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                {Object.entries(PRIORITY_LABEL)
                  .filter(
                    ([priority]) =>
                      priority !== "not_viable" ||
                      (metrics.leads.byPriority.not_viable ?? 0) > 0,
                  )
                  .map(([priority, label]) => (
                    <li key={priority}>
                      {label}:{" "}
                      {metrics.leads.byPriority[
                        priority as keyof typeof metrics.leads.byPriority
                      ] ?? 0}
                    </li>
                  ))}
              </ul>
            </div>
          </div>

          {metrics.alerts.length > 0 && (
            <div className="rounded-2xl border border-gold/50 bg-gold/10 p-4">
              <p className="text-sm font-semibold text-cocoa">Para tener en cuenta</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                {metrics.alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="rounded-2xl border border-border-soft bg-cream-light p-5 text-sm text-text-secondary">
          Esta ejecución no llegó a calcular métricas. El detalle quedó
          registrado internamente.
        </p>
      )}
    </div>
  );
}

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  return (
    <ul className="divide-y divide-border-soft rounded-2xl border border-border-soft bg-cream-light">
      {rows.map((row) => (
        <li
          key={`${row.generated_at}-${row.period_start}`}
          className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-cocoa">
              Semana del {periodLabel(row.period_start, row.period_end)}
            </p>
            <p className="text-xs text-text-secondary">
              {formatDateTimeVe(row.generated_at)} · Ejecución{" "}
              {TRIGGER_LABEL[row.trigger_type].toLowerCase()}
            </p>
          </div>
          <StatusBadge status={row.status} />
        </li>
      ))}
    </ul>
  );
}

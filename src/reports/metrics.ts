import type {
  AutomationEventMetricsRow,
  LeadMetricsRow,
  ReportPeriod,
  WeeklyReportMetrics,
} from "./types";

/**
 * Condición acordada con el dueño del proyecto: los registros actuales son
 * pruebas funcionales del challenge, no clientes comerciales. Debe verse
 * explícitamente en el correo y en la página pública.
 */
export const DATA_DISCLAIMER =
  "Los registros de este periodo son pruebas funcionales del Platzi Vibe " +
  "Coding Challenge, no actividad comercial real.";

const EMAIL_EVENT_TYPES = ["customer_email", "owner_email"] as const;

export interface ComputeMetricsInput {
  period: ReportPeriod;
  /** Leads con created_at dentro del periodo (solo columnas no personales). */
  leadsInPeriod: LeadMetricsRow[];
  /** Total histórico de filas en `leads` (solo los leads automatizados desde el Reto 4). */
  totalLeads: number;
  /** Leads con celebración entre hoy y 7 días, de cualquier fecha de registro. */
  upcomingCelebrations: number;
  /** Eventos de automatización con created_at dentro del periodo. */
  eventsInPeriod: AutomationEventMetricsRow[];
}

/**
 * Transforma filas crudas en el contrato de métricas del reporte. Función
 * pura: toda la interpretación (deduplicación de correos, tasa, alertas)
 * vive aquí para poder probarse sin Supabase.
 */
export function computeWeeklyMetrics(input: ComputeMetricsInput): WeeklyReportMetrics {
  const bySource = { cake_request: 0, cake_design: 0, agent_message: 0 };
  const byPriority = { not_viable: 0, urgent: 0, high: 0, normal: 0 };

  for (const lead of input.leadsInPeriod) {
    bySource[lead.source_type] += 1;
    byPriority[lead.priority] += 1;
  }

  let eventsSuccess = 0;
  let eventsError = 0;
  for (const event of input.eventsInPeriod) {
    if (event.status === "success") eventsSuccess += 1;
    else eventsError += 1;
  }

  // Envíos lógicos de correo: deduplicados por lead + tipo. Un error
  // seguido de un reintento exitoso es UN envío exitoso; contar filas
  // crudas inflaría los fallos.
  const emailOutcomes = new Map<string, boolean>();
  for (const event of input.eventsInPeriod) {
    if (!EMAIL_EVENT_TYPES.includes(event.event_type as (typeof EMAIL_EVENT_TYPES)[number])) {
      continue;
    }
    const key = `${event.lead_id}:${event.event_type}`;
    const succeeded = emailOutcomes.get(key) ?? false;
    emailOutcomes.set(key, succeeded || event.status === "success");
  }

  const attempted = emailOutcomes.size;
  let sent = 0;
  for (const succeeded of emailOutcomes.values()) {
    if (succeeded) sent += 1;
  }
  const failed = attempted - sent;
  const sendSuccessRate = attempted === 0 ? null : Math.round((sent / attempted) * 1000) / 1000;

  const newInPeriod = input.leadsInPeriod.length;

  const alerts: string[] = [];
  if (failed > 0) {
    alerts.push(
      failed === 1
        ? "1 envío de correo automático falló esta semana: revisar el registro de automatización y la configuración de correo."
        : `${failed} envíos de correo automático fallaron esta semana: revisar el registro de automatización y la configuración de correo.`,
    );
  }
  if (input.upcomingCelebrations > 0) {
    alerts.push(
      input.upcomingCelebrations === 1
        ? "1 celebración cae en los próximos 7 días: priorizar su confirmación."
        : `${input.upcomingCelebrations} celebraciones caen en los próximos 7 días: priorizar su confirmación.`,
    );
  }
  if (newInPeriod === 0) {
    alerts.push("Sin solicitudes nuevas esta semana.");
  }

  return {
    period: {
      start: input.period.start,
      end: input.period.end,
      timezone: input.period.timezone,
    },
    leads: {
      newInPeriod,
      totalAccumulated: input.totalLeads,
      bySource,
      byPriority,
    },
    upcomingCelebrations: { next7Days: input.upcomingCelebrations },
    automation: {
      eventsInPeriod: { success: eventsSuccess, error: eventsError },
      emails: { attempted, sent, failed, sendSuccessRate },
    },
    alerts,
    dataDisclaimer: DATA_DISCLAIMER,
  };
}

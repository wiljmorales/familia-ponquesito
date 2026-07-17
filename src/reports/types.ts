import type { LeadPriority } from "@/leads/classify";
import type { LeadSourceType } from "@/leads/types";

/**
 * Semana reportada: días calendario del negocio (America/Caracas) más sus
 * límites como instantes UTC, listos para filtrar sobre created_at
 * (timestamptz). Caracas es UTC-4 fijo, así que la traducción es exacta.
 */
export interface ReportPeriod {
  /** Lunes, inclusive ("YYYY-MM-DD", calendario de Caracas). */
  start: string;
  /** Domingo, inclusive ("YYYY-MM-DD", calendario de Caracas). */
  end: string;
  /** Medianoche de Caracas del lunes inicial, como instante UTC (ISO). */
  startUtc: string;
  /** Medianoche de Caracas del lunes siguiente, como instante UTC (ISO), exclusivo. */
  endExclusiveUtc: string;
  timezone: "America/Caracas";
}

/**
 * Columnas de `leads` que el reporte tiene permitido consultar. A propósito
 * NO incluye customer_name, customer_email, customer_whatsapp ni
 * normalized_payload: el reporte solo necesita agregados y ningún dato
 * personal debe entrar a este flujo (ni a Gemini, ni al correo, ni a la
 * página pública).
 */
export interface LeadMetricsRow {
  id: string;
  source_type: LeadSourceType;
  celebration_date: string;
  priority: LeadPriority;
  created_at: string;
}

/**
 * Columnas de `lead_automation_events` que el reporte consulta. Sin
 * error_message ni metadata: para las métricas solo importan tipo, estado
 * y fecha.
 */
export interface AutomationEventMetricsRow {
  lead_id: string;
  event_type: "lead_registered" | "customer_email" | "owner_email";
  status: "success" | "error";
  created_at: string;
}

/**
 * Contrato de métricas del reporte semanal. Es lo ÚNICO que ven Gemini, el
 * correo y la página pública: solo agregados, nunca datos personales.
 *
 * Terminología de correo a propósito: `sent` significa "aceptado por el
 * servidor SMTP" (lo único que Nodemailer puede afirmar), no "entregado"
 * ni "leído". Por eso la tasa se llama sendSuccessRate.
 */
export interface WeeklyReportMetrics {
  period: { start: string; end: string; timezone: string };
  leads: {
    newInPeriod: number;
    totalAccumulated: number;
    bySource: Record<LeadSourceType, number>;
    byPriority: Record<LeadPriority, number>;
  };
  upcomingCelebrations: {
    /**
     * Leads (de cualquier fecha de registro, no solo del periodo) cuya
     * celebración cae entre hoy y dentro de 7 días, calendario de Caracas.
     */
    next7Days: number;
  };
  automation: {
    /** Conteo crudo de eventos del periodo, incluidos los lead_registered. */
    eventsInPeriod: { success: number; error: number };
    /**
     * Envíos de correo lógicos, deduplicados por lead + tipo de correo: un
     * intento fallido seguido de un reintento exitoso cuenta como UN envío
     * exitoso, no como un error y un éxito.
     */
    emails: {
      attempted: number;
      sent: number;
      failed: number;
      /** sent / attempted, redondeada a 3 decimales; null si no hubo envíos. */
      sendSuccessRate: number | null;
    };
  };
  /** Derivadas por reglas fijas, nunca por IA. */
  alerts: string[];
  /** Condición explícita: los registros actuales son pruebas del challenge. */
  dataDisclaimer: string;
}

export type SummarySource = "gemini" | "fallback";

export type WeeklyReportTrigger = "scheduled" | "manual";

export type WeeklyReportStatus = "processing" | "sent" | "email_error" | "data_error";

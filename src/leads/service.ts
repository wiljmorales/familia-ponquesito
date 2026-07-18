import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  LEADS_TABLE,
  LEAD_AUTOMATION_EVENTS_TABLE,
  RESERVATION_EVENTS_TABLE,
} from "@/lib/supabase/config";
import { generateReferenceCode } from "@/lib/reference-code";
import { defaultEmailClient, type EmailClient, type SendEmailResult } from "@/email/client";
import {
  buildCustomerConfirmationEmail,
} from "@/email/templates/customer-confirmation";
import { buildOwnerNotificationEmail } from "@/email/templates/owner-notification";
import { buildReservationCustomerEmail } from "@/email/templates/reservation-customer";
import { buildReservationOwnerEmail } from "@/email/templates/reservation-owner";
import type { ReservationEmailContext } from "@/email/templates/reservation-types";
import { buildCustomerContactWhatsappLink } from "@/lib/utils/whatsapp";
import { getReferenceImageSignedUrl } from "@/lib/actions/get-reference-image-url";
import { BUSINESS_NAME } from "@/lib/constants/business";
import { classifyLeadPriority, type LeadPriority } from "./classify";
import type {
  LeadSourceType,
  ProcessLeadInput,
  ReservationLeadDetails,
} from "./types";

const UNIQUE_VIOLATION = "23505";
const MAX_REFERENCE_CODE_ATTEMPTS = 5;

const REFERENCE_CODE_PREFIX: Record<LeadSourceType, string> = {
  cake_request: "FP-2",
  cake_design: "FP-3",
  agent_message: "FP-7",
  cake_reservation: "FP-8",
};

type EventType = "lead_registered" | "customer_email" | "owner_email";
type EventStatus = "success" | "error";

interface LeadRow {
  id: string;
  reference_code: string;
  priority: LeadPriority;
}

type ReservationProcessLeadInput = ProcessLeadInput & {
  source: "cake_reservation";
  referenceCode: string;
  reservation: ReservationLeadDetails;
};

type EmailOutcome = SendEmailResult | { ok: true; skipped: true };

export interface ProcessLeadDeps {
  /** Inyectable para pruebas; por defecto el cliente real (service_role). */
  supabase?: SupabaseClient;
  /** Inyectable para pruebas; por defecto SMTP (Nodemailer) o el stub de desarrollo. */
  emailClient?: EmailClient;
  /** Inyectable para pruebas; por defecto process.env.KAREM_NOTIFICATION_EMAIL. */
  karemEmail?: string;
}

/**
 * Registra un lead (Reto 2 o Reto 3), lo clasifica, y dispara el correo de
 * confirmación al cliente y la notificación a Karem. Nunca lanza: cualquier
 * fallo interno se registra en lead_automation_events y en logs, pero jamás
 * afecta la fila original (cake_requests/cake_designs), que ya se guardó
 * antes de llamar a esta función. Pensado para llamarse dentro de
 * `after()` en las Server Actions de envío, así no bloquea la respuesta al
 * usuario.
 */
export async function processLead(
  input: ProcessLeadInput,
  deps: ProcessLeadDeps = {},
  reservationEmailContext?: ReservationEmailContext,
): Promise<void> {
  let supabase: SupabaseClient;
  try {
    supabase = deps.supabase ?? getSupabaseServiceClient();
  } catch (error) {
    console.error("[leads] Supabase no está configurado, no se puede procesar el lead", error);
    return;
  }

  const emailClient = deps.emailClient ?? defaultEmailClient();

  try {
    if (
      input.source === "cake_reservation" &&
      (!input.reservation || !reservationEmailContext)
    ) {
      console.error("[leads] contexto incompleto para procesar una reserva");
      return;
    }

    if (
      input.source === "cake_reservation" &&
      containsPrivateContext(input, reservationEmailContext!)
    ) {
      console.error("[leads] se rechazó un payload de reserva con contexto privado persistible");
      return;
    }

    const lead = await ensureLead(supabase, input);
    if (!lead) return;

    await projectReservationEvent(supabase, input, {
      eventType: "lead_registered",
      dedupeKey: "lead_registered",
    });

    const whatsappMessage = `Hola ${input.customerName}, soy Karem de ${BUSINESS_NAME}. Vi tu solicitud ${lead.reference_code}, ¿conversamos por aquí?`;
    const whatsappLink = buildCustomerContactWhatsappLink(input.customerWhatsapp, whatsappMessage);

    // Independientes a propósito: si uno falla, el otro se intenta igual.
    const customerOutcome = await sendCustomerEmail(
      supabase,
      emailClient,
      lead,
      input,
      reservationEmailContext,
    );
    await projectEmailOutcome(supabase, input, "customer", customerOutcome);

    const ownerOutcome = await sendOwnerEmail(
      supabase,
      emailClient,
      lead,
      input,
      whatsappLink,
      deps.karemEmail,
      reservationEmailContext,
    );
    await projectEmailOutcome(supabase, input, "owner", ownerOutcome);
  } catch (error) {
    console.error("[leads] fallo inesperado procesando el lead", error);
  }
}

/**
 * Entrada explícita para reservas: mantiene el secreto fuera del contrato
 * persistible y reutiliza el pipeline central e idempotente de leads.
 */
export async function processReservationLead(
  input: ReservationProcessLeadInput,
  emailContext: ReservationEmailContext,
  deps: ProcessLeadDeps = {},
): Promise<void> {
  if (
    input.referenceCode !== input.reservation.code ||
    input.celebrationDate !== input.reservation.celebrationDate
  ) {
    console.error("[leads] contrato inconsistente para una reserva");
    return;
  }
  return processLead(input, deps, emailContext);
}

function containsPrivateContext(
  input: ProcessLeadInput,
  context: ReservationEmailContext,
): boolean {
  const persistible = JSON.stringify({
    normalizedPayload: input.normalizedPayload,
    reservation: input.reservation,
  });
  return (
    persistible.includes(context.manageUrl) ||
    /"(?:manageUrl|manageToken|manageTokenHash|manage_token_hash|token)"\s*:/i.test(
      persistible,
    )
  );
}

async function ensureLead(
  supabase: SupabaseClient,
  input: ProcessLeadInput,
): Promise<LeadRow | null> {
  const existing = await findLeadBySource(supabase, input.source, input.sourceId);
  if (existing) return existing;

  const priority = classifyLeadPriority(input.celebrationDate);

  for (let attempt = 0; attempt < MAX_REFERENCE_CODE_ATTEMPTS; attempt++) {
    const referenceCode =
      input.referenceCode ?? generateReferenceCode(REFERENCE_CODE_PREFIX[input.source]);

    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .insert({
        source_type: input.source,
        source_id: input.sourceId,
        reference_code: referenceCode,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_whatsapp: input.customerWhatsapp,
        celebration_date: input.celebrationDate,
        priority,
        normalized_payload: input.normalizedPayload,
      })
      .select("id, reference_code, priority")
      .single();

    if (!error) {
      const lead = data as LeadRow;
      await logEvent(supabase, lead.id, "lead_registered", "success");
      return lead;
    }

    if (error.code === UNIQUE_VIOLATION) {
      if (error.message.includes("leads_source_unique")) {
        // Otra ejecución concurrente ya registró este mismo lead: la
        // reutilizamos en vez de tratarlo como error.
        return await findLeadBySource(supabase, input.source, input.sourceId);
      }
      // Colisión de reference_code: reintenta con uno nuevo.
      continue;
    }

    console.error("[leads] fallo al registrar el lead", error);
    await logFailedRegistration(supabase, input, error.message);
    return null;
  }

  console.error("[leads] no se pudo generar un reference_code único para el lead");
  return null;
}

async function findLeadBySource(
  supabase: SupabaseClient,
  source: LeadSourceType,
  sourceId: string,
): Promise<LeadRow | null> {
  const { data, error } = await supabase
    .from(LEADS_TABLE)
    .select("id, reference_code, priority")
    .eq("source_type", source)
    .eq("source_id", sourceId)
    .maybeSingle();

  if (error) {
    console.error("[leads] fallo al buscar el lead existente", error);
    return null;
  }

  return data as LeadRow | null;
}

/**
 * No hay lead_id todavía si el insert en `leads` mismo falló, así que este
 * fallo solo queda en el log del servidor (no hay fila padre donde
 * registrar el evento). El lead original en cake_requests/cake_designs no
 * se ve afectado: ya se guardó antes de llegar aquí.
 */
async function logFailedRegistration(
  supabase: SupabaseClient,
  input: ProcessLeadInput,
  message: string,
): Promise<void> {
  console.error(
    `[leads] no se pudo registrar el lead para ${input.source}:${input.sourceId}: ${message}`,
  );
}

async function hasSuccessfulEvent(
  supabase: SupabaseClient,
  leadId: string,
  eventType: EventType,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(LEAD_AUTOMATION_EVENTS_TABLE)
    .select("id")
    .eq("lead_id", leadId)
    .eq("event_type", eventType)
    .eq("status", "success")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[leads] fallo al consultar eventos previos de automatización", error);
    // Ante duda, no bloqueamos el reintento: preferible un correo de más
    // (poco probable, requeriría dos fallos consecutivos de la misma
    // consulta) que perder la notificación por un error de lectura.
    return false;
  }

  return Boolean(data);
}

async function logEvent(
  supabase: SupabaseClient,
  leadId: string,
  eventType: EventType,
  status: EventStatus,
  options: { errorMessage?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const { error } = await supabase.from(LEAD_AUTOMATION_EVENTS_TABLE).insert({
    lead_id: leadId,
    event_type: eventType,
    status,
    error_message: options.errorMessage ?? null,
    metadata: options.metadata ?? null,
  });

  if (error) {
    console.error("[leads] fallo al registrar el evento de automatización", error);
  }
}

/** Un solo reintento ante un fallo transitorio del proveedor de correo. */
async function sendWithRetry(
  emailClient: EmailClient,
  message: { to: string; subject: string; html: string; text: string },
): Promise<SendEmailResult> {
  const first = await emailClient.send(message);
  if (first.ok) return first;
  return emailClient.send(message);
}

async function sendCustomerEmail(
  supabase: SupabaseClient,
  emailClient: EmailClient,
  lead: LeadRow,
  input: ProcessLeadInput,
  reservationEmailContext?: ReservationEmailContext,
): Promise<EmailOutcome> {
  if (await hasSuccessfulEvent(supabase, lead.id, "customer_email")) {
    return { ok: true, skipped: true };
  }

  const email =
    input.source === "cake_reservation" && input.reservation && reservationEmailContext
      ? buildReservationCustomerEmail({
          status: input.reservation.status,
          customerName: input.customerName,
          code: input.reservation.code,
          celebrationDate: input.reservation.celebrationDate,
          summaryLines: input.summaryLines,
          manageUrl: reservationEmailContext.manageUrl,
        })
      : buildCustomerConfirmationEmail({
          source: input.source,
          customerName: input.customerName,
          referenceCode: lead.reference_code,
          celebrationDate: input.celebrationDate,
          summaryLines: input.summaryLines,
        });

  const result = await sendWithRetry(emailClient, {
    to: input.customerEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await logEvent(supabase, lead.id, "customer_email", result.ok ? "success" : "error", {
    errorMessage: result.error,
    metadata: result.ok ? { providerId: result.providerId } : undefined,
  });
  return result;
}

async function sendOwnerEmail(
  supabase: SupabaseClient,
  emailClient: EmailClient,
  lead: LeadRow,
  input: ProcessLeadInput,
  whatsappLink: string,
  karemEmailOverride?: string,
  reservationEmailContext?: ReservationEmailContext,
): Promise<EmailOutcome> {
  if (await hasSuccessfulEvent(supabase, lead.id, "owner_email")) {
    return { ok: true, skipped: true };
  }

  const karemEmail = karemEmailOverride ?? process.env.KAREM_NOTIFICATION_EMAIL;
  if (!karemEmail) {
    const error =
      "Falta configurar KAREM_NOTIFICATION_EMAIL: no hay destinatario para la notificación interna.";
    await logEvent(supabase, lead.id, "owner_email", "error", {
      errorMessage: error,
    });
    return { ok: false, error };
  }

  let referenceImageSignedUrl: string | null = null;
  if (
    (input.source === "cake_request" || input.source === "cake_reservation") &&
    input.referenceImagePath
  ) {
    referenceImageSignedUrl = await getReferenceImageSignedUrl(input.referenceImagePath);
  }

  const email =
    input.source === "cake_reservation" && input.reservation && reservationEmailContext
      ? buildReservationOwnerEmail({
          reservation: input.reservation,
          customerName: input.customerName,
          customerWhatsapp: input.customerWhatsapp,
          customerEmail: input.customerEmail,
          whatsappLink,
          referenceImageSignedUrl,
          capacity: reservationEmailContext.capacity,
        })
      : buildOwnerNotificationEmail({
          source: input.source,
          referenceCode: lead.reference_code,
          priority: lead.priority,
          customerName: input.customerName,
          customerWhatsapp: input.customerWhatsapp,
          customerEmail: input.customerEmail,
          celebrationDate: input.celebrationDate,
          summaryLines: input.summaryLines,
          whatsappLink,
          referenceImageSignedUrl,
        });

  const result = await sendWithRetry(emailClient, {
    to: karemEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await logEvent(supabase, lead.id, "owner_email", result.ok ? "success" : "error", {
    errorMessage: result.error,
    metadata: result.ok ? { providerId: result.providerId } : undefined,
  });
  return result;
}

async function projectEmailOutcome(
  supabase: SupabaseClient,
  input: ProcessLeadInput,
  recipient: "customer" | "owner",
  outcome: EmailOutcome,
): Promise<void> {
  if (input.source !== "cake_reservation") return;

  const success = outcome.ok;
  await projectReservationEvent(supabase, input, {
    eventType: success ? "email_sent" : "email_failed",
    dedupeKey: success ? `${recipient}_email_sent` : null,
    metadata: {
      recipient,
      ...("providerId" in outcome && outcome.providerId
        ? { provider: outcome.providerId }
        : {}),
    },
  });
}

async function projectReservationEvent(
  supabase: SupabaseClient,
  input: ProcessLeadInput,
  event: {
    eventType: "lead_registered" | "email_sent" | "email_failed";
    dedupeKey: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.source !== "cake_reservation") return;

  const { error } = await supabase.from(RESERVATION_EVENTS_TABLE).insert({
    reservation_id: input.sourceId,
    event_type: event.eventType,
    dedupe_key: event.dedupeKey,
    metadata: event.metadata ?? null,
  });

  if (error && error.code !== UNIQUE_VIOLATION) {
    // El detalle del proveedor de base de datos no se persiste. Esta
    // proyección es secundaria y jamás hace fallar leads ni correos.
    console.error("[leads] no se pudo proyectar un evento seguro de reserva");
  }
}

import "server-only";
import { backendPost } from "@/lib/backend/client";
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

const MAX_REFERENCE_CODE_ATTEMPTS = 5;
type Post = typeof backendPost;

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
  /** Inyectable para pruebas; por defecto la API interna de Django. */
  post?: Post;
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
  const post = deps.post ?? backendPost;
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

    const lead = await ensureLead(post, input);
    if (!lead) return;

    await projectReservationEvent(post, input, {
      eventType: "lead_registered",
      dedupeKey: "lead_registered",
    });

    const whatsappMessage = `Hola ${input.customerName}, soy Karem de ${BUSINESS_NAME}. Vi tu solicitud ${lead.reference_code}, ¿conversamos por aquí?`;
    const whatsappLink = buildCustomerContactWhatsappLink(input.customerWhatsapp, whatsappMessage);

    // Independientes a propósito: si uno falla, el otro se intenta igual.
    const customerOutcome = await sendCustomerEmail(
      post,
      emailClient,
      lead,
      input,
      reservationEmailContext,
    );
    await projectEmailOutcome(post, input, "customer", customerOutcome);

    const ownerOutcome = await sendOwnerEmail(
      post,
      emailClient,
      lead,
      input,
      whatsappLink,
      deps.karemEmail,
      reservationEmailContext,
    );
    await projectEmailOutcome(post, input, "owner", ownerOutcome);
  } catch {
    console.error("[leads] fallo inesperado procesando el lead");
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
  post: Post,
  input: ProcessLeadInput,
): Promise<LeadRow | null> {
  const existing = await findLeadBySource(post, input.source, input.sourceId);
  if (existing) return existing;

  const priority = classifyLeadPriority(input.celebrationDate);

  for (let attempt = 0; attempt < MAX_REFERENCE_CODE_ATTEMPTS; attempt++) {
    const referenceCode =
      input.referenceCode ?? generateReferenceCode(REFERENCE_CODE_PREFIX[input.source]);

    const result = await post<{ ok: boolean; id?: string; reference_code?: string; priority?: LeadPriority; error?: string }>(
      "lead-ensure", {
        source_type: input.source,
        source_id: input.sourceId,
        reference_code: referenceCode,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_whatsapp: input.customerWhatsapp,
        celebration_date: input.celebrationDate,
        priority,
        normalized_payload: input.normalizedPayload,
      });

    if (result.ok && result.id && result.reference_code && result.priority) {
      return { id: result.id, reference_code: result.reference_code, priority: result.priority };
    }

    if (result.error === "code_taken") {
      const concurrent = await findLeadBySource(post, input.source, input.sourceId);
      if (concurrent) return concurrent;
      // Colisión de reference_code: reintenta con uno nuevo.
      continue;
    }

    logFailedRegistration(input);
    return null;
  }

  console.error("[leads] no se pudo generar un reference_code único para el lead");
  return null;
}

async function findLeadBySource(
  post: Post,
  source: LeadSourceType,
  sourceId: string,
): Promise<LeadRow | null> {
  const result = await post<{ ok: boolean; lead: LeadRow | null }>("lead-by-source", {
    source_type: source, source_id: sourceId,
  });
  return result.ok ? result.lead : null;
}

/**
 * No hay lead_id todavía si el insert en `leads` mismo falló, así que este
 * fallo solo queda en el log del servidor (no hay fila padre donde
 * registrar el evento). El lead original en cake_requests/cake_designs no
 * se ve afectado: ya se guardó antes de llegar aquí.
 */
function logFailedRegistration(input: ProcessLeadInput): void {
  console.error(`[leads] no se pudo registrar el lead para ${input.source}:${input.sourceId}`);
}

async function claimEmail(post: Post, leadId: string, eventType: EventType): Promise<string | null> {
  const result = await post<{ ok: boolean; state?: "claimed" | "sent" | "busy"; claim?: string }>(
    "email-claim", { lead_id: leadId, event_type: eventType },
  );
  if (!result.ok) throw new Error("No se pudo reservar el envío de correo.");
  return result.state === "claimed" && result.claim ? result.claim : null;
}

async function finishEmail(
  post: Post, leadId: string, eventType: EventType, claim: string, result: SendEmailResult,
): Promise<void> {
  const finished = await post<{ ok: boolean }>("email-finish", {
    lead_id: leadId, event_type: eventType, claim, success: result.ok,
    provider_id: result.ok ? result.providerId : null,
  });
  if (!finished.ok) throw new Error("No se pudo registrar el resultado del correo.");
}

async function logEvent(
  post: Post,
  leadId: string,
  eventType: EventType,
  status: EventStatus,
  options: { errorMessage?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const result = await post<{ ok: boolean }>("lead-event", {
    lead_id: leadId,
    event_type: eventType,
    status,
    error_message: options.errorMessage ?? null,
    metadata: options.metadata ?? null,
  });

  if (!result.ok) {
    console.error("[leads] fallo al registrar el evento de automatización");
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
  post: Post,
  emailClient: EmailClient,
  lead: LeadRow,
  input: ProcessLeadInput,
  reservationEmailContext?: ReservationEmailContext,
): Promise<EmailOutcome> {
  const claim = await claimEmail(post, lead.id, "customer_email");
  if (!claim) {
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

  await finishEmail(post, lead.id, "customer_email", claim, result);
  return result;
}

async function sendOwnerEmail(
  post: Post,
  emailClient: EmailClient,
  lead: LeadRow,
  input: ProcessLeadInput,
  whatsappLink: string,
  karemEmailOverride?: string,
  reservationEmailContext?: ReservationEmailContext,
): Promise<EmailOutcome> {
  const karemEmail = karemEmailOverride ?? process.env.KAREM_NOTIFICATION_EMAIL;
  if (!karemEmail) {
    const error =
      "Falta configurar KAREM_NOTIFICATION_EMAIL: no hay destinatario para la notificación interna.";
    await logEvent(post, lead.id, "owner_email", "error", {
      errorMessage: error,
    });
    return { ok: false, error };
  }
  const claim = await claimEmail(post, lead.id, "owner_email");
  if (!claim) return { ok: true, skipped: true };

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

  await finishEmail(post, lead.id, "owner_email", claim, result);
  return result;
}

async function projectEmailOutcome(
  post: Post,
  input: ProcessLeadInput,
  recipient: "customer" | "owner",
  outcome: EmailOutcome,
): Promise<void> {
  if (input.source !== "cake_reservation") return;
  if ("skipped" in outcome && outcome.skipped) return;

  const success = outcome.ok;
  await projectReservationEvent(post, input, {
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
  post: Post,
  input: ProcessLeadInput,
  event: {
    eventType: "lead_registered" | "email_sent" | "email_failed";
    dedupeKey: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.source !== "cake_reservation") return;

  const result = await post<{ ok: boolean }>("reservation-event", {
    reservation_id: input.sourceId,
    event_type: event.eventType,
    dedupe_key: event.dedupeKey,
    metadata: event.metadata ?? null,
  });

  if (!result.ok) {
    // El detalle del proveedor de base de datos no se persiste. Esta
    // proyección es secundaria y jamás hace fallar leads ni correos.
    console.error("[leads] no se pudo proyectar un evento seguro de reserva");
  }
}

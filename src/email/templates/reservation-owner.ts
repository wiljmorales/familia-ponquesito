import type { ReservationLeadDetails } from "@/leads/types";
import { escapeHtml } from "../escape";
import { formatDateEs } from "../format-date";
import type { EmailContent } from "./types";
import type { ReservationEmailContext } from "./reservation-types";

export interface ReservationOwnerEmailInput {
  reservation: ReservationLeadDetails;
  customerName: string;
  customerWhatsapp: string;
  customerEmail: string;
  whatsappLink: string;
  /** Enlace firmado temporal generado por el mecanismo privado existente. */
  referenceImageSignedUrl?: string | null;
  /** Solo la fotografía de capacidad; manageUrl jamás se pasa a esta plantilla. */
  capacity: ReservationEmailContext["capacity"];
}

export function buildReservationOwnerEmail(
  input: ReservationOwnerEmailInput,
): EmailContent {
  const { reservation, capacity } = input;
  const humanReview = reservation.status === "human_review";
  const safeCode = escapeHtml(reservation.code);
  const dateLabel = escapeHtml(formatDateEs(reservation.celebrationDate));
  const reasonsHtml = reservation.classificationReasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  const reasonsText = reservation.classificationReasons
    .map((reason) => `- ${reason}`)
    .join("\n");

  const reviewHtml = humanReview
    ? `<p style="background: #fff4cc; border-left: 4px solid #c99620; padding: 8px 12px;">
  <strong>REVISIÓN PERSONALIZADA:</strong> esta fecha es preferida, no está apartada
  y la solicitud no consumió capacidad.</p>`
    : "";

  const capacityLabel = humanReview
    ? `Fotografía provisional: ${capacity.remaining} libres de ${capacity.total}; usados ${capacity.used}. La solicitud no consumió puntos.`
    : `Después de reservar: ${capacity.remaining} libres de ${capacity.total}; usados ${capacity.used}.`;

  const imageHtml = input.referenceImageSignedUrl
    ? `<p><strong>Imagen de referencia:</strong> <a href="${escapeHtml(input.referenceImageSignedUrl)}">ver imagen</a> (enlace temporal)</p>`
    : reservation.hasReferenceImage
      ? "<p><strong>Imagen de referencia:</strong> el cliente indicó que tiene una; debe compartirla durante el contacto.</p>"
      : "";

  const deliveryLabel =
    reservation.fulfillmentType === "delivery"
      ? `Delivery — ${reservation.deliveryDetails ?? "sin detalle"}`
      : "Retiro";

  const subject = `${humanReview ? "[REVISIÓN] " : ""}Reserva ${reservation.code} — Agenda Ponquesito`;

  const html = `
<div style="font-family: sans-serif; color: #4b2e2b; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  ${reviewHtml}
  <p><strong>Código:</strong> ${safeCode}<br />
  <strong>Estado:</strong> ${humanReview ? "Revisión personalizada" : "Pendiente de anticipo"}<br />
  <strong>${humanReview ? "Fecha preferida" : "Fecha"}:</strong> ${dateLabel}</p>
  <p><strong>Cliente:</strong> ${escapeHtml(input.customerName)}<br />
  <strong>WhatsApp:</strong> ${escapeHtml(input.customerWhatsapp)}<br />
  <strong>Correo:</strong> ${escapeHtml(input.customerEmail)}</p>
  <p><strong>Pedido:</strong> ${reservation.guestCount} personas · ${escapeHtml(reservation.flavorLabel)}<br />
  <strong>Temática:</strong> ${escapeHtml(reservation.theme ?? "Sin temática indicada")}<br />
  <strong>Entrega:</strong> ${escapeHtml(deliveryLabel)}<br />
  <strong>Puntos estimados:</strong> ${reservation.capacityPoints}${humanReview ? " (no consumidos)" : ""}<br />
  <strong>Capacidad:</strong> ${escapeHtml(capacityLabel)}</p>
  <p><strong>Descripción:</strong> ${escapeHtml(reservation.designDescription)}</p>
  <p><strong>Clasificación:</strong></p>
  <ul>${reasonsHtml}</ul>
  ${imageHtml}
  <p><a href="${escapeHtml(input.whatsappLink)}">Contactar por WhatsApp</a></p>
</div>
`.trim();

  const text = [
    humanReview
      ? "REVISIÓN PERSONALIZADA: fecha preferida, no apartada; no consumió capacidad."
      : "RESERVA PENDIENTE DE ANTICIPO",
    "",
    `Código: ${reservation.code}`,
    `Estado: ${humanReview ? "Revisión personalizada" : "Pendiente de anticipo"}`,
    `${humanReview ? "Fecha preferida" : "Fecha"}: ${formatDateEs(reservation.celebrationDate)}`,
    "",
    `Cliente: ${input.customerName}`,
    `WhatsApp: ${input.customerWhatsapp}`,
    `Correo: ${input.customerEmail}`,
    "",
    `Personas: ${reservation.guestCount}`,
    `Sabor: ${reservation.flavorLabel}`,
    `Temática: ${reservation.theme ?? "Sin temática indicada"}`,
    `Entrega: ${deliveryLabel}`,
    `Puntos estimados: ${reservation.capacityPoints}${humanReview ? " (no consumidos)" : ""}`,
    `Capacidad: ${capacityLabel}`,
    `Descripción: ${reservation.designDescription}`,
    "",
    "Clasificación:",
    reasonsText,
    "",
    input.referenceImageSignedUrl
      ? `Imagen de referencia (enlace temporal): ${input.referenceImageSignedUrl}`
      : reservation.hasReferenceImage
        ? "Imagen de referencia: el cliente indicó que tiene una; solicitarla durante el contacto."
        : "Imagen de referencia: no indicada.",
    "",
    `Contactar por WhatsApp: ${input.whatsappLink}`,
  ].join("\n");

  return { subject, html, text };
}

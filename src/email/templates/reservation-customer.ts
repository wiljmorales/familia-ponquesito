import {
  BUSINESS_NAME,
  DEPOSIT_PERCENT,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  SLOGAN,
} from "@/lib/constants/business";
import { escapeHtml } from "../escape";
import { formatDateEs } from "../format-date";
import type { EmailContent } from "./types";

/**
 * Correo al cliente de Agenda Ponquesito (Reto 8). Dos variantes:
 *
 * - pending_deposit: la fecha quedó REGISTRADA (hay disponibilidad) pero
 *   el pedido NO está confirmado hasta el anticipo del 50 %. Prohibido
 *   decir "pedido confirmado".
 * - human_review: el diseño exige revisión personalizada; la fecha
 *   preferida NO está reservada. Prohibido "fecha reservada", "cupo
 *   apartado" o "último espacio".
 *
 * Es el ÚNICO lugar de todo el sistema donde aparece el enlace privado de
 * gestión (manageUrl, con el token en claro): no va en logs, eventos,
 * leads ni en el correo interno de Karem.
 */
export interface ReservationCustomerEmailInput {
  status: "pending_deposit" | "human_review";
  customerName: string;
  code: string;
  celebrationDate: string;
  summaryLines: string[];
  manageUrl: string;
}

export function buildReservationCustomerEmail(
  input: ReservationCustomerEmailInput,
): EmailContent {
  const safeName = escapeHtml(input.customerName);
  const safeCode = escapeHtml(input.code);
  const dateLabel = escapeHtml(formatDateEs(input.celebrationDate));
  const summaryHtml = input.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const summaryText = input.summaryLines.map((line) => `- ${line}`).join("\n");
  const safeManageUrl = escapeHtml(input.manageUrl);

  const isPending = input.status === "pending_deposit";

  const subject = isPending
    ? `Recibimos tu reserva ${input.code} — ${BUSINESS_NAME}`
    : `Recibimos tu solicitud ${input.code} — ${BUSINESS_NAME}`;

  const statusHtml = isPending
    ? `<p>Hay disponibilidad para ese día y tu fecha quedó <strong>registrada, pendiente
  de confirmación</strong> mediante el anticipo del ${DEPOSIT_PERCENT}&nbsp;%. Tu pedido
  todavía no está confirmado: ${BUSINESS_NAME} se comunicará contigo para coordinar
  el pago del anticipo.</p>`
    : `<p>Como tu diseño necesita una <strong>revisión personalizada</strong>, la fecha que
  nos indicaste <strong>todavía no está reservada</strong>. ${BUSINESS_NAME} revisará tu
  pedido y se comunicará contigo para confirmar viabilidad y disponibilidad.</p>`;

  const statusText = isPending
    ? `Hay disponibilidad para ese día y tu fecha quedó registrada, pendiente de confirmación mediante el anticipo del ${DEPOSIT_PERCENT} %. Tu pedido todavía no está confirmado: ${BUSINESS_NAME} se comunicará contigo para coordinar el pago del anticipo.`
    : `Como tu diseño necesita una revisión personalizada, la fecha que nos indicaste todavía no está reservada. ${BUSINESS_NAME} revisará tu pedido y se comunicará contigo para confirmar viabilidad y disponibilidad.`;

  const html = `
<div style="font-family: sans-serif; color: #4b2e2b; max-width: 480px; margin: 0 auto; line-height: 1.5;">
  <p>Hola ${safeName},</p>
  <p>Recibimos tu solicitud en la Agenda Ponquesito.</p>
  <p>Código: <strong>${safeCode}</strong><br />
  ${isPending ? "Fecha solicitada" : "Fecha preferida"}: <strong>${dateLabel}</strong></p>
  <ul>${summaryHtml}</ul>
  ${statusHtml}
  <p><a href="${safeManageUrl}">Consulta o gestiona tu solicitud aquí</a><br />
  <span style="font-size: 13px;">Este enlace es personal: no lo compartas.</span></p>
  <p>¿Dudas? Escríbenos por Instagram:
  <a href="${escapeHtml(INSTAGRAM_URL)}">${INSTAGRAM_HANDLE}</a>.</p>
  <p><em>${SLOGAN}</em></p>
</div>
`.trim();

  const text = [
    `Hola ${input.customerName},`,
    "",
    "Recibimos tu solicitud en la Agenda Ponquesito.",
    "",
    `Código: ${input.code}`,
    `${isPending ? "Fecha solicitada" : "Fecha preferida"}: ${dateLabel}`,
    "",
    summaryText,
    "",
    statusText,
    "",
    `Consulta o gestiona tu solicitud aquí (enlace personal, no lo compartas): ${input.manageUrl}`,
    "",
    `¿Dudas? Escríbenos por Instagram: ${INSTAGRAM_HANDLE} (${INSTAGRAM_URL})`,
    "",
    SLOGAN,
  ].join("\n");

  return { subject, html, text };
}

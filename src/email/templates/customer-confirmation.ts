import { BUSINESS_NAME, SLOGAN } from "@/lib/constants/business";
import type { LeadSourceType } from "@/leads/types";
import { escapeHtml } from "../escape";
import { formatDateEs } from "../format-date";
import type { EmailContent } from "./types";

export interface CustomerConfirmationInput {
  source: LeadSourceType;
  customerName: string;
  referenceCode: string;
  celebrationDate: string;
  summaryLines: string[];
}

const INTRO_BY_SOURCE: Record<LeadSourceType, string> = {
  cake_design: "Recibimos el diseño de tu torta y ya está en manos de Familia Ponquesito.",
  cake_request: "Recibimos tu solicitud de cotización.",
  agent_message: "Recibimos tu mensaje y tu solicitud ya está en manos de Familia Ponquesito.",
};

/**
 * Correo de confirmación al cliente, personalizado por origen del lead. El
 * asunto no interpola texto libre del cliente (nombre, descripción): usa
 * solo el código de referencia, generado por el servidor.
 */
export function buildCustomerConfirmationEmail(
  input: CustomerConfirmationInput,
): EmailContent {
  const safeName = escapeHtml(input.customerName);
  const dateLabel = formatDateEs(input.celebrationDate);
  const intro = INTRO_BY_SOURCE[input.source];

  const summaryHtml = input.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const summaryText = input.summaryLines.map((line) => `- ${line}`).join("\n");

  const subject = `Confirmación de tu solicitud ${input.referenceCode} — ${BUSINESS_NAME}`;

  const html = `
<div style="font-family: sans-serif; color: #4b2e2b; max-width: 480px; margin: 0 auto; line-height: 1.5;">
  <p>Hola ${safeName},</p>
  <p>${intro}</p>
  <p>Código de referencia: <strong>${input.referenceCode}</strong><br />
  Fecha de celebración: <strong>${dateLabel}</strong></p>
  <ul>${summaryHtml}</ul>
  <p>Te contactaremos por WhatsApp para confirmar disponibilidad y preparar tu
  cotización. Recuerda: se requieren al menos 3 días de anticipación y la
  reserva se confirma con el 50% del monto.</p>
  <p><em>${SLOGAN}</em></p>
</div>
`.trim();

  const text = [
    `Hola ${input.customerName},`,
    "",
    intro,
    "",
    `Código de referencia: ${input.referenceCode}`,
    `Fecha de celebración: ${dateLabel}`,
    "",
    summaryText,
    "",
    "Te contactaremos por WhatsApp para confirmar disponibilidad y preparar tu cotización. Recuerda: se requieren al menos 3 días de anticipación y la reserva se confirma con el 50% del monto.",
    "",
    SLOGAN,
  ].join("\n");

  return { subject, html, text };
}

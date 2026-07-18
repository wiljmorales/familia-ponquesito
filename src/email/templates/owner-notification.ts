import type { LeadPriority } from "@/leads/classify";
import type { LeadSourceType } from "@/leads/types";
import { escapeHtml } from "../escape";
import { formatDateEs } from "../format-date";
import type { EmailContent } from "./types";

export interface OwnerNotificationInput {
  source: LeadSourceType;
  referenceCode: string;
  priority: LeadPriority;
  customerName: string;
  customerWhatsapp: string;
  customerEmail: string;
  celebrationDate: string;
  summaryLines: string[];
  whatsappLink: string;
  /** Solo Reto 2, cuando el cliente adjuntó una imagen de referencia. */
  referenceImageSignedUrl?: string | null;
}

const SOURCE_LABEL: Record<LeadSourceType, string> = {
  cake_request: "Solicitud de cotización (formulario)",
  cake_design: "Crea tu torta (juego)",
  agent_message: "Agente de Atención (mensaje libre)",
};

const PRIORITY_LABEL: Record<LeadPriority, string> = {
  not_viable: "NO VIABLE — menos de 3 días",
  urgent: "URGENTE",
  high: "Alta",
  normal: "Normal",
};

/**
 * Correo interno a Karem con el resumen completo del lead. El asunto solo
 * usa valores generados por el servidor (prioridad, código de referencia,
 * origen) — nunca texto libre del cliente.
 */
export function buildOwnerNotificationEmail(input: OwnerNotificationInput): EmailContent {
  const safeName = escapeHtml(input.customerName);
  const safeWhatsapp = escapeHtml(input.customerWhatsapp);
  const safeEmail = escapeHtml(input.customerEmail);
  const dateLabel = formatDateEs(input.celebrationDate);
  const priorityLabel = PRIORITY_LABEL[input.priority];
  const sourceLabel = SOURCE_LABEL[input.source];

  const summaryHtml = input.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const summaryText = input.summaryLines.map((line) => `- ${line}`).join("\n");

  const subject = `[${priorityLabel}] Nuevo lead ${input.referenceCode} — ${sourceLabel}`;

  const imageHtml = input.referenceImageSignedUrl
    ? `<p>Imagen de referencia: <a href="${escapeHtml(input.referenceImageSignedUrl)}">ver imagen</a> (enlace temporal, expira pronto)</p>`
    : "";

  const html = `
<div style="font-family: sans-serif; color: #4b2e2b; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  <p><strong>Prioridad:</strong> ${priorityLabel}<br />
  <strong>Origen:</strong> ${sourceLabel}<br />
  <strong>Código de referencia:</strong> ${input.referenceCode}</p>
  <p><strong>Cliente:</strong> ${safeName}<br />
  <strong>WhatsApp:</strong> ${safeWhatsapp}<br />
  <strong>Correo:</strong> ${safeEmail}<br />
  <strong>Fecha:</strong> ${dateLabel}</p>
  <p><strong>Resumen:</strong></p>
  <ul>${summaryHtml}</ul>
  ${imageHtml}
  <p><a href="${escapeHtml(input.whatsappLink)}">Contactar por WhatsApp</a></p>
</div>
`.trim();

  const textLines = [
    `Prioridad: ${priorityLabel}`,
    `Origen: ${sourceLabel}`,
    `Código de referencia: ${input.referenceCode}`,
    "",
    `Cliente: ${input.customerName}`,
    `WhatsApp: ${input.customerWhatsapp}`,
    `Correo: ${input.customerEmail}`,
    `Fecha: ${dateLabel}`,
    "",
    "Resumen:",
    summaryText,
    "",
  ];

  if (input.referenceImageSignedUrl) {
    textLines.push(
      `Imagen de referencia (enlace temporal, expira pronto): ${input.referenceImageSignedUrl}`,
      "",
    );
  }

  textLines.push(`Contactar por WhatsApp: ${input.whatsappLink}`);

  return { subject, html, text: textLines.join("\n") };
}

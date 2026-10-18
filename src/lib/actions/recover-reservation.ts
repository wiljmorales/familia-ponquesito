"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { backendPost } from "@/lib/backend/client";
import { generateManageToken } from "@/reservations/token";
import { absoluteUrl } from "@/lib/site-url";
import { defaultEmailClient } from "@/email/client";
import { escapeHtml } from "@/email/escape";

const recoverySchema = z.object({
  code: z.string().trim().regex(/^FP-8-[2-9A-HJKMNP-Z]{4}$/),
  email: z.string().trim().max(160).email(),
});

const GENERIC = "Si el código y el correo coinciden, enviaremos un enlace nuevo a esa misma dirección. Revisa también spam.";

/** Cualquiera puede pedirlo, pero solo el correo guardado recibe el enlace.
 * Django limita por IP y reserva; la respuesta nunca confirma existencia.
 * El envío corre en after(): si se esperara a SMTP, el tiempo de respuesta
 * revelaría qué combinaciones de código y correo existen.
 */
export async function requestReservationLinkRecovery(formData: FormData): Promise<{ message: string }> {
  const parsed = recoverySchema.safeParse({ code: formData.get("code"), email: formData.get("email") });
  if (!parsed.success) return { message: GENERIC };
  const { token, tokenHash } = generateManageToken();
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    const response = await backendPost<{ ok: boolean; deliver: boolean; recipient?: string }>("agenda-recovery", {
      code: parsed.data.code,
      email: parsed.data.email,
      new_token_hash: tokenHash,
      remote_ip: remoteIp,
    });
    if (response.ok && response.deliver && response.recipient) {
      const url = absoluteUrl(`/agenda/reservas/${encodeURIComponent(parsed.data.code)}?token=${encodeURIComponent(token)}`);
      const recipient = response.recipient;
      after(async () => {
        try {
          const sent = await defaultEmailClient().send({
            to: recipient,
            subject: `Nuevo enlace para tu reserva ${parsed.data.code} — Familia Ponquesito`,
            text: `Solicitaste un nuevo enlace para consultar tu reserva. Úsalo dentro de una hora: ${url}\n\nSi no lo pediste, ignora este mensaje; tu enlace anterior sigue válido hasta que uses el nuevo.`,
            html: `<p>Solicitaste un nuevo enlace para consultar tu reserva.</p><p><a href="${escapeHtml(url)}">Abrir mi reserva</a> (válido por una hora).</p><p>Si no lo pediste, ignora este mensaje.</p>`,
          });
          if (!sent.ok) console.error("[reservation-recovery] SMTP rechazó el mensaje de recuperación");
        } catch {
          console.error("[reservation-recovery] no se pudo enviar el correo de recuperación");
        }
      });
    }
  } catch {
    console.error("[reservation-recovery] no se pudo procesar la solicitud");
  }
  return { message: GENERIC };
}

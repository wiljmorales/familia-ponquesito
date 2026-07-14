import "server-only";
import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Id devuelto por el proveedor (Resend) cuando el envío tiene éxito. */
  providerId?: string;
  /** Mensaje seguro para logs/eventos; nunca incluye secretos. */
  error?: string;
}

export interface EmailClient {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Error desconocido al enviar el correo.";
}

class ResendEmailClient implements EmailClient {
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });

      if (error) {
        return { ok: false, error: error.message || "El proveedor de correo rechazó el envío." };
      }

      return { ok: true, providerId: data?.id };
    } catch (error) {
      return { ok: false, error: toSafeErrorMessage(error) };
    }
  }
}

/**
 * Solo para desarrollo/test: registra en consola en vez de enviar un
 * correo real. Nunca se usa en producción (ver defaultEmailClient) — así
 * `npm run dev` y `npm test` funcionan sin credenciales de Resend, igual
 * que el proveedor determinista del asistente sin GEMINI_API_KEY.
 */
class DevLoggerEmailClient implements EmailClient {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.log(`[email:dev] simulando envío a ${input.to} — "${input.subject}"`);
    return { ok: true, providerId: "dev-stub" };
  }
}

/**
 * En producción, si falta configuración real de Resend, este cliente
 * siempre devuelve un error explícito: nunca simula un envío exitoso.
 */
class MisconfiguredEmailClient implements EmailClient {
  constructor(private readonly missingVars: string[]) {}

  async send(): Promise<SendEmailResult> {
    return {
      ok: false,
      error: `Correo no configurado en producción: falta ${this.missingVars.join(", ")}.`,
    };
  }
}

/**
 * Mismo patrón que defaultProvider() en src/assistant/service.ts: con
 * RESEND_API_KEY + RESEND_FROM_EMAIL configuradas se usa el cliente real.
 * Sin ellas, en desarrollo/test se usa un stub que solo loguea; en
 * producción se usa un cliente que siempre falla de forma explícita y
 * registrable, nunca en silencio.
 */
export function defaultEmailClient(): EmailClient {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (apiKey && from) {
    return new ResendEmailClient(apiKey, from);
  }

  const missingVars = [!apiKey && "RESEND_API_KEY", !from && "RESEND_FROM_EMAIL"].filter(
    (v): v is string => Boolean(v),
  );

  if (process.env.NODE_ENV === "production") {
    return new MisconfiguredEmailClient(missingVars);
  }

  return new DevLoggerEmailClient();
}

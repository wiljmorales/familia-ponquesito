import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Id devuelto por el proveedor (messageId de Nodemailer) cuando el envío tiene éxito. */
  providerId?: string;
  /** Mensaje seguro para logs/eventos; nunca incluye secretos. */
  error?: string;
}

export interface EmailClient {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

/** El proveedor podría ecoar el cuerpo (incluido un enlace privado): no
 * persistimos ni imprimimos su mensaje, solo una categoría técnica segura. */
function toSafeErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "SMTP_ERROR";
  return /^(E[A-Z0-9_]{2,30}|SMTP_ERROR)$/.test(code) ? `Correo no entregado (${code}).` : "Correo no entregado.";
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

class SmtpEmailClient implements EmailClient {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    this.from = config.from;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });

      return { ok: true, providerId: info.messageId };
    } catch (error) {
      return { ok: false, error: toSafeErrorMessage(error) };
    }
  }
}

/**
 * Solo para desarrollo/test: registra en consola en vez de enviar un
 * correo real. Nunca se usa en producción (ver defaultEmailClient) — así
 * `npm run dev` y `npm test` funcionan sin credenciales SMTP, igual que
 * el proveedor determinista del asistente sin GEMINI_API_KEY.
 */
class DevLoggerEmailClient implements EmailClient {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.log(`[email:dev] simulando envío a ${input.to} — "${input.subject}"`);
    return { ok: true, providerId: "dev-stub" };
  }
}

/**
 * En producción, si falta configuración real de SMTP, este cliente
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
 * Mismo patrón que defaultProvider() en src/assistant/service.ts: con las
 * variables SMTP completas se usa el transportador real de Nodemailer
 * (Gmail vía contraseña de aplicación, nunca la contraseña normal). Sin
 * ellas, en desarrollo/test se usa un stub que solo loguea; en producción
 * se usa un cliente que siempre falla de forma explícita y registrable,
 * nunca en silencio.
 */
export function defaultEmailClient(): EmailClient {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  const from = process.env.EMAIL_FROM;

  const port = Number(portRaw);
  const missingVars = [
    !host && "SMTP_HOST",
    !portRaw && "SMTP_PORT",
    portRaw && !(Number.isInteger(port) && port > 0) && "SMTP_PORT (debe ser un número entero)",
    !user && "SMTP_USER",
    !pass && "SMTP_APP_PASSWORD",
    !from && "EMAIL_FROM",
  ].filter((v): v is string => Boolean(v));

  if (host && user && pass && from && missingVars.length === 0) {
    // Sin SMTP_SECURE explícito, se infiere del puerto: 465 es SMTPS
    // (TLS implícito); cualquier otro (587, 25) arranca en claro y
    // negocia STARTTLS.
    const secureRaw = process.env.SMTP_SECURE;
    const secure = secureRaw === undefined || secureRaw === "" ? port === 465 : secureRaw === "true";

    return new SmtpEmailClient({ host, port, secure, user, pass, from });
  }

  if (process.env.NODE_ENV === "production") {
    return new MisconfiguredEmailClient(missingVars);
  }

  return new DevLoggerEmailClient();
}

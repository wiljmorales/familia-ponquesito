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

/**
 * Convierte cualquier error en un mensaje apto para logs y para
 * lead_automation_events. Además de normalizar el tipo, redacta la
 * contraseña de aplicación por si el proveedor la incluyera en el texto
 * del error — un secreto jamás debe llegar a un log ni a la base de datos.
 */
function toSafeErrorMessage(error: unknown, secret?: string): string {
  let message: string;
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  else message = "Error desconocido al enviar el correo.";

  if (secret) message = message.split(secret).join("[redactado]");
  return message;
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
  private readonly pass: string;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    this.from = config.from;
    this.pass = config.pass;
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
      return { ok: false, error: toSafeErrorMessage(error, this.pass) };
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

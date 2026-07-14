import { afterEach, describe, expect, it, vi } from "vitest";

/* Nodemailer mockeado: estas pruebas jamás abren una conexión SMTP real. */

// client.ts importa "server-only" (mismo guard que supabase/server.ts) para
// que el bundler falle si algún día se importa desde código de cliente.
// Vitest corre en Node puro, sin ese bundler, así que se neutraliza aquí.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => {
  mocks.createTransport.mockImplementation(() => ({ sendMail: mocks.sendMail }));
  return { default: { createTransport: mocks.createTransport } };
});

import { defaultEmailClient } from "./client";

const ORIGINAL_ENV = { ...process.env };

const SMTP_ENV = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "remitente@example.com",
  SMTP_APP_PASSWORD: "clave-de-aplicacion-secreta",
  EMAIL_FROM: "Familia Ponquesito <remitente@example.com>",
};

function stubSmtpEnv(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...SMTP_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
  mocks.createTransport.mockClear();
  mocks.sendMail.mockReset();
});

const SAMPLE_INPUT = {
  to: "cliente@example.com",
  subject: "Asunto",
  html: "<p>Hola</p>",
  text: "Hola",
};

describe("defaultEmailClient", () => {
  it("con la configuración SMTP completa envía por Nodemailer mapeando from/to/subject/html/text", async () => {
    stubSmtpEnv();
    mocks.sendMail.mockResolvedValueOnce({ messageId: "<abc123@smtp.gmail.com>" });

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: SMTP_ENV.EMAIL_FROM,
      to: SAMPLE_INPUT.to,
      subject: SAMPLE_INPUT.subject,
      html: SAMPLE_INPUT.html,
      text: SAMPLE_INPUT.text,
    });
    expect(result).toEqual({ ok: true, providerId: "<abc123@smtp.gmail.com>" });
  });

  it("convierte SMTP_PORT a número y SMTP_SECURE a booleano al crear el transportador", async () => {
    stubSmtpEnv();

    defaultEmailClient();

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_ENV.SMTP_USER, pass: SMTP_ENV.SMTP_APP_PASSWORD },
    });
  });

  it("interpreta SMTP_SECURE=false como booleano falso", async () => {
    stubSmtpEnv({ SMTP_PORT: "587", SMTP_SECURE: "false" });

    defaultEmailClient();

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("sin SMTP_SECURE, infiere secure=true solo para el puerto 465", async () => {
    stubSmtpEnv({ SMTP_SECURE: undefined });
    defaultEmailClient();
    expect(mocks.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );

    stubSmtpEnv({ SMTP_SECURE: undefined, SMTP_PORT: "587" });
    defaultEmailClient();
    expect(mocks.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("mapea un fallo de sendMail sin lanzar y sin filtrar la contraseña de aplicación", async () => {
    stubSmtpEnv();
    mocks.sendMail.mockRejectedValueOnce(
      new Error(`535 credenciales rechazadas para ${SMTP_ENV.SMTP_APP_PASSWORD}`),
    );

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("535");
    expect(result.error).not.toContain(SMTP_ENV.SMTP_APP_PASSWORD);
  });

  it("en desarrollo/test, sin configuración SMTP, usa el stub y nunca toca la red", async () => {
    stubSmtpEnv({
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
      SMTP_SECURE: undefined,
      SMTP_USER: undefined,
      SMTP_APP_PASSWORD: undefined,
      EMAIL_FROM: undefined,
    });
    vi.stubEnv("NODE_ENV", "test");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(true);
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("en producción, sin configuración SMTP, nunca simula éxito", async () => {
    stubSmtpEnv({
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
      SMTP_SECURE: undefined,
      SMTP_USER: undefined,
      SMTP_APP_PASSWORD: undefined,
      EMAIL_FROM: undefined,
    });
    vi.stubEnv("NODE_ENV", "production");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD", "EMAIL_FROM"]) {
      expect(result.error).toContain(name);
    }
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("en producción con solo una variable faltante, reporta específicamente cuál falta sin exponer valores", async () => {
    stubSmtpEnv({ SMTP_APP_PASSWORD: undefined });
    vi.stubEnv("NODE_ENV", "production");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("SMTP_APP_PASSWORD");
    expect(result.error).not.toContain("SMTP_HOST");
    expect(result.error).not.toContain(SMTP_ENV.SMTP_USER);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("en producción, un SMTP_PORT no numérico se trata como configuración inválida, no como éxito", async () => {
    stubSmtpEnv({ SMTP_PORT: "no-es-un-numero" });
    vi.stubEnv("NODE_ENV", "production");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("SMTP_PORT");
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});

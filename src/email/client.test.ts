import { afterEach, describe, expect, it, vi } from "vitest";

/* SDK mockeado: estas pruebas jamás llaman a Resend de verdad. */

// client.ts importa "server-only" (mismo guard que supabase/server.ts) para
// que el bundler falle si algún día se importa desde código de cliente.
// Vitest corre en Node puro, sin ese bundler, así que se neutraliza aquí.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("resend", () => {
  class Resend {
    emails = { send: mocks.send };
    constructor(public apiKey: string) {}
  }
  return { Resend };
});

import { defaultEmailClient } from "./client";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
  mocks.send.mockReset();
});

const SAMPLE_INPUT = {
  to: "cliente@example.com",
  subject: "Asunto",
  html: "<p>Hola</p>",
  text: "Hola",
};

describe("defaultEmailClient", () => {
  it("usa el cliente real de Resend cuando RESEND_API_KEY y RESEND_FROM_EMAIL están configuradas", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "pedidos@example.com";
    mocks.send.mockResolvedValueOnce({ data: { id: "email_123" }, error: null });

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "pedidos@example.com", to: SAMPLE_INPUT.to }),
    );
    expect(result).toEqual({ ok: true, providerId: "email_123" });
  });

  it("mapea un error del proveedor sin lanzar", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "pedidos@example.com";
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: "dominio no verificado", statusCode: 403, name: "invalid_from_address" },
    });

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("dominio no verificado");
  });

  it("en desarrollo/test, sin credenciales, usa el stub y nunca llama al SDK real", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    vi.stubEnv("NODE_ENV", "test");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("en producción, sin credenciales, nunca simula éxito", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    vi.stubEnv("NODE_ENV", "production");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("RESEND_API_KEY");
    expect(result.error).toContain("RESEND_FROM_EMAIL");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("en producción con solo una variable faltante, reporta específicamente cuál falta", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.RESEND_FROM_EMAIL;
    vi.stubEnv("NODE_ENV", "production");

    const client = defaultEmailClient();
    const result = await client.send(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("RESEND_FROM_EMAIL");
    expect(result.error).not.toContain("RESEND_API_KEY");
  });
});

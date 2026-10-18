// Cliente de correo real de la app (src/email/client.ts, nodemailer) contra el
// SMTP de pruebas de Preview: Mailpit en api-staging.familiaponquesito.com:465
// (TLS implícito verificado con las raíces del sistema, AUTH). Lo ejecuta
// deploy/staging/probar-correo.sh. Solo escribe a @example.invalid; un
// destinatario fuera de .invalid (example.com, reservado) debe rechazarse.
// En la simulación (FP_SIM_IP), el nombre se resuelve a la IP del contenedor.
import dns from "node:dns";
import { describe, expect, it } from "vitest";
import { defaultEmailClient } from "@/email/client";

const NOMBRE = "api-staging.familiaponquesito.com";
const simIp = process.env.FP_SIM_IP;
if (simIp) {
  // nodemailer resuelve con new dns.Resolver(): se sustituye en su prototipo.
  type Cb = (err: NodeJS.ErrnoException | null, addresses?: string[]) => void;
  const proto = dns.Resolver.prototype as unknown as Record<string, (host: string, cb: Cb) => void>;
  const resolve4 = proto.resolve4;
  proto.resolve4 = function (host, cb) {
    return host === NOMBRE ? cb(null, [simIp]) : resolve4.call(this, host, cb);
  };
  proto.resolve6 = (host, cb) => cb(Object.assign(new Error(`sin AAAA para ${host}`), { code: dns.NODATA }));
}

const asunto = process.env.FP_ASUNTO ?? "";

describe("SMTP de pruebas de Preview", () => {
  it("usa SMTP real con TLS implícito hacia api-staging", () => {
    expect(asunto).toMatch(/^fp-preview-correo /);
    expect(process.env.SMTP_HOST).toBe(NOMBRE);
    expect(process.env.SMTP_PORT).toBe("465");
    expect(process.env.SMTP_SECURE).toBe("true");
  });

  it("entrega a @example.invalid", async () => {
    const r = await defaultEmailClient().send({
      to: "cliente.preview@example.invalid",
      subject: asunto,
      text: "Prueba del SMTP de Preview.",
      html: "<p>Prueba del SMTP de Preview.</p>",
    });
    expect(r.error ?? "", "error del cliente de correo").toBe("");
    expect(r).toMatchObject({ ok: true });
  });

  it("rechaza un destinatario fuera de .invalid", async () => {
    const r = await defaultEmailClient().send({
      to: "rechazo@example.com",
      subject: asunto,
      text: "No debe aceptarse.",
      html: "<p>No debe aceptarse.</p>",
    });
    expect(r.ok).toBe(false);
  });
});

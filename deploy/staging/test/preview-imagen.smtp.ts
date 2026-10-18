// «Preview simulada»: la Server Action real de solicitud con la imagen de
// FP_IMAGEN (4.000.000 bytes), con las mismas variables que Vercel Preview
// (API por HTTPS en api-staging, SMTP de pruebas en api-staging:465). Deja en
// el buzón de pruebas los correos que deploy/staging/verificar-imagen-preview.sh
// revisa. Escribe una solicitud sintética en ponquesito_staging.
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { submitCakeRequest } from "@/lib/actions/submit-cake-request";

const NOMBRE = "api-staging.familiaponquesito.com";
const simIp = process.env.FP_SIM_IP;
if (simIp) {
  // fetch (undici) usa dns.lookup; nodemailer, new dns.Resolver().
  const lookup = dns.lookup;
  dns.lookup = ((host: string, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (...a: unknown[]) => void;
    const options = (typeof opts === "object" && opts ? opts : {}) as { all?: boolean };
    if (host !== NOMBRE) return (lookup as (...a: unknown[]) => void)(host, opts, cb);
    return options.all ? callback(null, [{ address: simIp, family: 4 }]) : callback(null, simIp, 4);
  }) as typeof dns.lookup;
  type Cb = (err: NodeJS.ErrnoException | null, addresses?: string[]) => void;
  const proto = dns.Resolver.prototype as unknown as Record<string, (host: string, cb: Cb) => void>;
  const resolve4 = proto.resolve4;
  proto.resolve4 = function (host, cb) { return host === NOMBRE ? cb(null, [simIp]) : resolve4.call(this, host, cb); };
  proto.resolve6 = (host, cb) => cb(Object.assign(new Error(`sin AAAA para ${host}`), { code: dns.NODATA }));
}

async function drainAfter() {
  const g = globalThis as { __fpAfter?: Promise<unknown>[] };
  while (g.__fpAfter?.length) await Promise.all(g.__fpAfter.splice(0));
}

describe("Preview simulada", () => {
  it("solicitud con la imagen máxima: API por HTTPS y correos por el SMTP de pruebas", async () => {
    expect(process.env.PONQUESITO_API_URL).toBe(`https://${NOMBRE}`);
    expect(process.env.SMTP_HOST).toBe(NOMBRE);
    expect(process.env.KAREM_NOTIFICATION_EMAIL).toBe("propietaria.preview@example.invalid");
    const imagen = readFileSync(process.env.FP_IMAGEN!);
    expect(imagen.length).toBe(4_000_000);
    const form = new FormData();
    for (const [k, v] of Object.entries({ customerName: "Cliente Preview", whatsapp: "+58 412 0000000", email: "cliente.preview@example.invalid", celebrationDate: process.env.FP_FECHA!, celebrationType: "cumpleanos", guestCount: "12", preferredFlavor: "chocolate", cakeDescription: "Prueba de imagen máxima desde Preview" })) form.set(k, v);
    form.set("referenceImage", new File([imagen], "maxima.png", { type: "image/png" }));
    const r = await submitCakeRequest(form);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    await drainAfter();
  });
});

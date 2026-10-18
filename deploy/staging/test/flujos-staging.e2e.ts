// Flujos reales de la app (Server Actions y servicios de Next.js) contra el
// backend de staging: por túnel SSH (deploy/staging/probar-tunel.sh) o por
// HTTPS a través de Caddy (deploy/staging/probar-https.sh), como Vercel Preview.
// Correo: receptor SMTP local que solo acepta destinatarios .invalid. fetch
// bloquea cualquier host que no sea el de PONQUESITO_API_URL. Sin GEMINI_API_KEY.
// Escribe datos sintéticos (.invalid) en ponquesito_staging; elige días con
// cupo libre para poder repetirse. Imprime solo conteos, nunca tokens ni cuerpos.
import { createHash } from "node:crypto";
import dns from "node:dns";
import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitCakeRequest } from "@/lib/actions/submit-cake-request";
import { submitCakeDesign } from "@/lib/actions/submit-cake-design";
import { submitAgendaReservation } from "@/lib/actions/agenda";
import { rescheduleManagedReservation, cancelManagedReservation } from "@/lib/actions/manage-reservation";
import { requestReservationLinkRecovery } from "@/lib/actions/recover-reservation";
import { lookupReservation } from "@/reservations/service";
import { generateWeeklyReport } from "@/reports/service";
import { backendPost } from "@/lib/backend/client";
import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import { pngExacto } from "./png-exacto.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const CUSTOMER = "cliente.staging@example.invalid";
const OWNER = "propietaria.staging@example.invalid";
const PUBLIC_ORIGIN = "https://api-staging.familiaponquesito.com";
const API_HOST = new URL(process.env.PONQUESITO_API_URL!).hostname;
// Simulación del VPS: el nombre público se resuelve a la IP del contenedor.
const simIp = process.env.FP_SIM_IP;
if (simIp) {
  const lookup = dns.lookup;
  dns.lookup = ((host: string, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (...a: unknown[]) => void;
    const options = (typeof opts === "object" && opts ? opts : {}) as { all?: boolean };
    if (host !== new URL(PUBLIC_ORIGIN).hostname) return (lookup as (...a: unknown[]) => void)(host, opts, cb);
    return options.all ? callback(null, [{ address: simIp, family: 4 }]) : callback(null, simIp, 4);
  }) as typeof dns.lookup;
}

interface Mail { rcpt: string[]; raw: string }
const mails: Mail[] = [];
const rejectedRcpt: string[] = [];
const blockedHosts: string[] = [];
const evidence: Record<string, unknown> = {};
const allowAgenda = { isReservationAllowedFn: async () => true };
const allowManage = { isModificationAllowedFn: async () => true };

function smtpSink(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    socket.write("220 local.staging ESMTP\r\n");
    let buf = "";
    let data = false;
    let cur: Mail = { rcpt: [], raw: "" };
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === ".") { data = false; mails.push(cur); cur = { rcpt: [], raw: "" }; socket.write("250 ok\r\n"); }
          else cur.raw += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          continue;
        }
        if (/^(EHLO|HELO) /i.test(line)) socket.write("250-local.staging\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (/^AUTH /i.test(line)) socket.write("235 ok\r\n");
        else if (/^MAIL FROM:/i.test(line)) { cur = { rcpt: [], raw: "" }; socket.write("250 ok\r\n"); }
        else if (/^RCPT TO:<[^>]+@[^>]+\.invalid>/i.test(line)) { cur.rcpt.push(line.replace(/^RCPT TO:<([^>]+)>.*/i, "$1")); socket.write("250 ok\r\n"); }
        else if (/^RCPT TO:/i.test(line)) { rejectedRcpt.push("rechazado"); socket.write("550 solo .invalid\r\n"); }
        else if (line === "DATA") { data = true; socket.write("354 go\r\n"); }
        else if (/^RSET/i.test(line)) { cur = { rcpt: [], raw: "" }; socket.write("250 ok\r\n"); }
        else if (/^QUIT/i.test(line)) { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    resolve({ server, port: typeof a === "object" && a ? a.port : 0 });
  }));
}

/** Texto decodificado de las partes MIME (quoted-printable o base64). */
function decoded(raw: string): string {
  let out = "";
  for (const m of raw.matchAll(/Content-Transfer-Encoding: (quoted-printable|base64)\n(?:[^\n]+\n)*\n([\s\S]*?)(?=\n--|$)/gi)) {
    out += "\n" + (m[1].toLowerCase() === "base64"
      ? Buffer.from(m[2].replace(/\s+/g, ""), "base64").toString("utf8")
      : Buffer.from(m[2].replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"));
  }
  return out || raw;
}
const mailsTo = (addr: string) => mails.filter((m) => m.rcpt.includes(addr));

async function drainAfter() {
  const g = globalThis as { __fpAfter?: Promise<unknown>[] };
  while (g.__fpAfter?.length) await Promise.all(g.__fpAfter.splice(0));
}

function tokenFrom(mail: Mail, code: string): string {
  const m = decoded(mail.raw).match(new RegExp(`/agenda/reservas/${code}\\?token=([A-Za-z0-9_%.~-]+)`));
  if (!m) throw new Error("correo sin enlace de gestión");
  return decodeURIComponent(m[1]);
}

const order = (date: string, name = "Cliente Staging") => ({
  guestCount: "10", tiers: "one", isCustomDesign: "no", hasReferenceImage: "no",
  designDescription: "Torta sencilla de prueba en staging", flavor: "chocolate", theme: "",
  customerName: name, email: CUSTOMER, phone: "+58 412 0000000", fulfillmentType: "pickup",
  deliveryDetails: "", companyWebsite: "", celebrationDate: date,
});

let sink: { server: Server; port: number };
let freeDays: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  sink = await smtpSink();
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1", SMTP_PORT: String(sink.port), SMTP_SECURE: "false",
    SMTP_USER: "staging-local", SMTP_APP_PASSWORD: "staging-local", EMAIL_FROM: "Familia Ponquesito <no-reply@example.invalid>",
    KAREM_NOTIFICATION_EMAIL: OWNER, APP_CANONICAL_URL: "https://staging.example.invalid",
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== API_HOST) { blockedHosts.push(url.hostname); throw new Error("red externa bloqueada"); }
    return realFetch(input, init);
  }) as typeof fetch;
  // Días sin reservas dentro de la ventana, lejos de los bordes.
  const today = businessTodayISO();
  const res = await backendPost<{ ok: boolean; days: { business_date: string; capacity_used: number; can_accept: boolean }[] }>(
    "agenda-availability", { start_date: addDaysISO(today, 6), end_date: addDaysISO(today, 55), capacity_points: 1 });
  freeDays = res.days.filter((d) => d.can_accept && d.capacity_used === 0).map((d) => d.business_date);
  if (freeDays.length < 5) throw new Error("staging no tiene 5 días libres para la prueba");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  sink?.server.close();
  evidence.correos_aceptados = mails.length;
  evidence.correos_dominios = [...new Set(mails.flatMap((m) => m.rcpt.map((r) => r.split("@")[1])))];
  evidence.destinatarios_rechazados = rejectedRcpt.length;
  evidence.hosts_externos_bloqueados = blockedHosts.length;
  console.log("EVIDENCIA_TUNEL " + JSON.stringify(evidence));
});

describe("flujos Next.js → backend de staging", () => {
  it("solicitud con imagen privada: correos y enlace firmado", async () => {
    const before = mails.length;
    const form = new FormData();
    for (const [k, v] of Object.entries({ customerName: "Cliente Staging", whatsapp: "+58 412 0000000", email: CUSTOMER, celebrationDate: freeDays[0], celebrationType: "cumpleanos", guestCount: "12", preferredFlavor: "chocolate", cakeDescription: "Descripción sintética para staging" })) form.set(k, v);
    form.set("referenceImage", new File([PNG], "ref.jpg", { type: "image/jpeg" }));
    expect((await submitCakeRequest(form)).ok).toBe(true);
    await drainAfter();
    const nuevos = mails.slice(before);
    expect(nuevos.filter((m) => m.rcpt.includes(CUSTOMER))).toHaveLength(1);
    const owner = nuevos.filter((m) => m.rcpt.includes(OWNER));
    expect(owner).toHaveLength(1);
    // Django firma con el origen público HTTPS; por túnel se reescribe al túnel.
    const signed = decoded(owner[0].raw).match(/https:\/\/api-staging\.familiaponquesito\.com\/api\/v1\/private-images\/[^\s"<>]+/)?.[0]
      ?.replace(/&amp;/g, "&").replace(PUBLIC_ORIGIN, process.env.PONQUESITO_API_URL!);
    expect(signed).toBeTruthy();
    const ok = await realFetch(signed!);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control") ?? "").toContain("no-store");
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG)).toBe(true);
    const bad = await realFetch(signed!.replace(/sig=.{6}/, "sig=AAAAAA"));
    expect(bad.status).not.toBe(200);
    evidence.solicitud = { correos: nuevos.length, enlace_firmado: ok.status, firma_alterada: bad.status };
  });

  it("imagen de 4.000.000 bytes (el máximo): se guarda íntegra y se descarga por el enlace firmado", async () => {
    const before = mails.length;
    const png: Buffer<ArrayBuffer> = pngExacto(4_000_000);
    const form = new FormData();
    for (const [k, v] of Object.entries({ customerName: "Cliente Staging", whatsapp: "+58 412 0000000", email: CUSTOMER, celebrationDate: freeDays[0], celebrationType: "cumpleanos", guestCount: "12", preferredFlavor: "chocolate", cakeDescription: "Imagen de tamaño máximo en staging" })) form.set(k, v);
    form.set("referenceImage", new File([png], "maxima.png", { type: "image/png" }));
    expect((await submitCakeRequest(form)).ok).toBe(true);
    await drainAfter();
    const owner = mails.slice(before).filter((m) => m.rcpt.includes(OWNER));
    expect(owner).toHaveLength(1);
    const signed = decoded(owner[0].raw).match(/https:\/\/api-staging\.familiaponquesito\.com\/api\/v1\/private-images\/[^\s"<>]+/)?.[0]
      ?.replace(/&amp;/g, "&").replace(PUBLIC_ORIGIN, process.env.PONQUESITO_API_URL!);
    expect(signed).toBeTruthy();
    const res = await realFetch(signed!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(body.length).toBe(4_000_000);
    expect(sha(body)).toBe(sha(png));
    evidence.imagen_maxima = { bytes: body.length, descarga: res.status, sha256_igual: true };
  });

  it("diseño personalizado: guardado y correos", async () => {
    const before = mails.length;
    const form = new FormData();
    for (const [k, v] of Object.entries({ customerName: "Cliente Staging", whatsapp: "+58 412 0000000", email: CUSTOMER, eventDate: freeDays[0], guestCount: "10", zone: "Centro" })) form.set(k, v);
    form.set("design", JSON.stringify({ version: 1, tiers: 1, baseVariant: "one-tier-cream", standVariant: "stand-blush", plaqueVariant: null, message: "", topperVariant: null }));
    const res = await submitCakeDesign(form);
    expect(res.ok).toBe(true);
    await drainAfter();
    expect(mails.length - before).toBe(2);
    evidence.diseno = { correos: mails.length - before };
  });

  it("agenda: reserva, enlace privado, token inválido, reprogramación y cancelación", async () => {
    const before = mails.length;
    const r = await submitAgendaReservation(order(freeDays[1]), allowAgenda);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await drainAfter();
    const toCustomer = mails.slice(before).filter((m) => m.rcpt.includes(CUSTOMER));
    expect(toCustomer).toHaveLength(1);
    const token = tokenFrom(toCustomer[0], r.code);
    expect((await lookupReservation(r.code, token)).ok).toBe(true);
    expect((await lookupReservation(r.code, "x".repeat(43))).ok).toBe(false);
    const moved = await rescheduleManagedReservation({ code: r.code, token, newDate: freeDays[2], confirmed: true }, allowManage);
    expect(moved.ok).toBe(true);
    const cancelled = await cancelManagedReservation({ code: r.code, token, confirmed: true }, allowManage);
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.reservation.status).toBe("cancelled");
    evidence.agenda = { reserva: r.status, token_invalido_rechazado: true, reprogramada: true, cancelada: true };
  });

  it("agenda: el último cupo no se sobrevende", async () => {
    const results = await Promise.all(Array.from({ length: 7 }, (_, n) => submitAgendaReservation(order(freeDays[3], `Cliente Staging ${n}`), allowAgenda)));
    const accepted = results.filter((x) => x.ok).length;
    expect(accepted).toBe(4);
    await drainAfter();
    evidence.cupo = { simultaneas: 7, aceptadas: accepted };
  });

  it("recuperación del enlace: solo al correo guardado; el token nuevo rota el anterior", async () => {
    const r = await submitAgendaReservation(order(freeDays[4]), allowAgenda);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await drainAfter();
    const oldToken = tokenFrom(mailsTo(CUSTOMER).slice(-1)[0], r.code);
    const wrong = new FormData(); wrong.set("code", r.code); wrong.set("email", "otra@example.invalid");
    const mid = mails.length;
    const wrongRes = await requestReservationLinkRecovery(wrong);
    await drainAfter();
    expect(mails.length).toBe(mid);
    const good = new FormData(); good.set("code", r.code); good.set("email", CUSTOMER);
    expect((await requestReservationLinkRecovery(good)).message).toBe(wrongRes.message);
    await drainAfter();
    const rec = mails.slice(mid).filter((m) => m.rcpt.includes(CUSTOMER));
    expect(rec).toHaveLength(1);
    const newToken = tokenFrom(rec[0], r.code);
    expect((await lookupReservation(r.code, newToken)).ok).toBe(true);
    expect((await lookupReservation(r.code, oldToken)).ok).toBe(false);
    evidence.recuperacion = { correo_ajeno_no_envia: true, token_nuevo_ok: true, token_anterior_rotado: true };
  });

  it("reporte semanal manual con resumen determinístico y correo", async () => {
    const res = await generateWeeklyReport("manual");
    expect(res.outcome).toBe("sent");
    evidence.reporte = res.outcome;
  });

  it("ningún destinatario fuera de .invalid ni red externa", () => {
    expect(rejectedRcpt).toHaveLength(0);
    expect(blockedHosts).toHaveLength(0);
  });
});

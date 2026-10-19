// Flujos de la app desplegada en Vercel Preview (no locales) contra el backend
// de staging. Las Server Actions se invocan como lo hace el navegador:
// POST a la página con Next-Action y los argumentos codificados con
// encodeReply de React. Todas las peticiones pasan por `vercel curl` (bypass de
// automatización del proyecto; Vercel Authentication sigue activa). El correo
// se lee de Mailpit por túnel SSH. Datos y destinatarios sintéticos
// (@example.invalid). Imprime solo estados y conteos: nunca tokens, enlaces
// firmados ni secretos.
// Uso (Node 22):
//   node deploy/staging/test/flujos-preview.mjs https://<alias-de-rama>
// Entorno: FP_SECRETOS (por defecto ../respaldos-privado/staging-vps/secretos),
//   SSH_KEY, FP_SSH (wilfredo@37.27.149.66).
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import http from "node:http";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(join(RAIZ, "package.json"));
const { encodeReply, createFromNodeStream } = require("next/dist/compiled/react-server-dom-turbopack/client.node.js");
const { pngExacto } = await import("./png-exacto.mjs");

const ALIAS = process.argv[2];
if (!/^https:\/\/familia-ponquesito-git-[a-z0-9-]+-wiljmorales-projects\.vercel\.app$/.test(ALIAS ?? "")) {
  console.error("Uso: node deploy/staging/test/flujos-preview.mjs https://<alias-de-rama>");
  process.exit(2);
}
const SECRETOS = process.env.FP_SECRETOS ?? resolve(RAIZ, "../respaldos-privado/staging-vps/secretos");
const SSH_KEY = process.env.SSH_KEY ?? join(process.env.HOME, ".ssh/familia_ponquesito");
const SSH = process.env.FP_SSH ?? "wilfredo@37.27.149.66";
const API = "https://api-staging.familiaponquesito.com";
const CLIENTE = "cliente.preview@example.invalid";
const PROPIETARIA = "propietaria.preview@example.invalid";
const TMP = mkdtempSync(join(tmpdir(), "fp-preview-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const resultados = [];
const evidencia = {};

function caso(nombre, ok, detalle = "") {
  resultados.push(ok);
  console.log(`   ${ok ? "ok  " : "FALLO"} ${nombre}${detalle ? `: ${detalle}` : ""}`);
  return ok;
}

// ---- Vercel: todas las peticiones por `vercel curl` -------------------------
let n = 0;
function vercel(ruta, { metodo = "GET", cabeceras = {}, cuerpo } = {}) {
  const id = ++n;
  const args = ["-sS", "-X", metodo, "-D", join(TMP, `h${id}`), "-o", join(TMP, `b${id}`), "-w", "%{http_code}", "--max-time", "120"];
  if (Object.keys(cabeceras).length) {
    // Por archivo (curl -H @archivo): la autorización no queda en argv.
    writeFileSync(join(TMP, `c${id}`), Object.entries(cabeceras).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n", { mode: 0o600 });
    args.push("-H", `@${join(TMP, `c${id}`)}`);
  }
  if (cuerpo !== undefined) {
    writeFileSync(join(TMP, `d${id}`), cuerpo, { mode: 0o600 });
    args.push("--data-binary", `@${join(TMP, `d${id}`)}`);
  }
  const p = spawnSync("npx", ["--no-install", "vercel@62.2.0", "curl", ruta, "--deployment", ALIAS, "--", ...args],
    { cwd: RAIZ, encoding: "utf8", env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" }, timeout: 180_000 });
  const estado = Number((p.stdout.match(/(\d{3})\s*$/) ?? [])[1] ?? 0);
  let cuerpoResp = Buffer.alloc(0), cab = "";
  try { cuerpoResp = readFileSync(join(TMP, `b${id}`)); cab = readFileSync(join(TMP, `h${id}`), "utf8"); } catch {}
  rmSync(join(TMP, `c${id}`), { force: true });
  rmSync(join(TMP, `d${id}`), { force: true });
  return { estado, cuerpo: cuerpoResp, cabeceras: cab.toLowerCase() };
}

/** Invoca una Server Action como el navegador y devuelve su valor de retorno. */
async function accion(pagina, id, args) {
  const codificado = await encodeReply(args);
  let cuerpo, tipo;
  if (typeof codificado === "string") {
    cuerpo = codificado; tipo = "text/plain;charset=UTF-8";
  } else {
    const r = new Response(codificado);
    tipo = r.headers.get("content-type"); cuerpo = Buffer.from(await r.arrayBuffer());
  }
  const r = vercel(pagina, { metodo: "POST", cuerpo, cabeceras: {
    "Next-Action": id, Accept: "text/x-component", "Content-Type": tipo, Origin: ALIAS,
  } });
  if (r.estado !== 200 || !r.cabeceras.includes("text/x-component")) {
    throw new Error(`acción ${pagina} → HTTP ${r.estado}`);
  }
  const raiz = await createFromNodeStream(Readable.from(r.cuerpo), { moduleMap: {}, serverModuleMap: null, moduleLoading: null });
  return raiz && typeof raiz === "object" && "a" in raiz ? await raiz.a : raiz;
}

/** Ids de las Server Actions referenciadas por los chunks de una página. */
function idsDeAcciones(pagina) {
  const html = vercel(pagina).cuerpo.toString("utf8");
  const ids = {};
  for (const c of new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js/g) ?? [])) {
    const js = vercel(c).cuerpo.toString("utf8");
    for (const m of js.matchAll(/createServerReference\)\("([0-9a-f]+)",[^)]*?"([A-Za-z]+)"\)/g)) ids[m[2]] = m[1];
  }
  return ids;
}

// ---- Mailpit por túnel SSH ------------------------------------------------
const PUERTO = 18025 + Math.floor(Math.random() * 500);
let tunel;
const abrirTunel = () => {
  tunel = spawn("ssh", ["-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=10",
    "-N", "-L", `127.0.0.1:${PUERTO}:127.0.0.1:8025`, SSH], { stdio: "ignore" });
};
abrirTunel();
const AUTH = "Basic " + Buffer.from("operador:" + readFileSync(join(SECRETOS, "mailpit-ui-password"), "utf8").trim()).toString("base64");
// Sin keep-alive: spawnSync bloquea el proceso mientras habla con Vercel y una
// conexión reutilizada puede estar ya cerrada por el otro extremo.
const mailpit1 = (ruta) => new Promise((ok, mal) => {
  const req = http.get({ host: "127.0.0.1", port: PUERTO, path: ruta, agent: false, headers: { Authorization: AUTH }, timeout: 15_000 }, (res) => {
    let datos = "";
    res.setEncoding("utf8").on("data", (d) => (datos += d)).on("end", () => {
      if (res.statusCode !== 200) return mal(new Error(`Mailpit ${ruta.split("?")[0]} → ${res.statusCode}`));
      try { ok(JSON.parse(datos)); } catch (e) { mal(e); }
    });
  });
  req.on("timeout", () => req.destroy(new Error("Mailpit: tiempo agotado"))).on("error", mal);
});
/** Con reintentos: si el túnel se cae, se reabre (los correos siguen en Mailpit). */
async function mailpit(ruta) {
  for (let intento = 1; ; intento++) {
    try { return await mailpit1(ruta); } catch (e) {
      if (intento >= 4) throw e;
      tunel.kill(); await new Promise((r) => setTimeout(r, 1500)); abrirTunel(); await new Promise((r) => setTimeout(r, 2500));
    }
  }
}
async function esperarTunel() {
  for (let i = 0; i < 50; i++) {
    try { await mailpit("/api/v1/messages?limit=1"); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("sin túnel a Mailpit");
}
const vistos = new Set();
/** Correos nuevos (no vistos antes) para `para`; espera a que lleguen `cuantos` (after()). */
async function correos(para, cuantos, { segundos = 45 } = {}) {
  const hasta = Date.now() + segundos * 1000;
  let nuevos = [];
  do {
    const d = await mailpit("/api/v1/messages?limit=200");
    nuevos = d.messages.filter((m) => !vistos.has(m.ID) && m.To.some((t) => t.Address === para));
    if (nuevos.length >= cuantos) break;
    await new Promise((r) => setTimeout(r, 1500));
  } while (Date.now() < hasta);
  const completos = [];
  for (const m of nuevos) { vistos.add(m.ID); completos.push(await mailpit(`/api/v1/message/${m.ID}`)); }
  return completos;
}
const textoDe = (m) => `${m.Text ?? ""}\n${m.HTML ?? ""}`.replace(/&amp;/g, "&");
function enlaceGestion(m, code) {
  const r = textoDe(m).match(new RegExp(`(https://[^/\\s"<>]+)/agenda/reservas/${code}\\?token=([A-Za-z0-9_%.~-]+)`));
  if (!r) throw new Error("correo sin enlace de gestión");
  return { origen: r[1], token: decodeURIComponent(r[2]) };
}
const enlaceFirmado = (m) => textoDe(m).match(/https:\/\/api-staging\.familiaponquesito\.com\/api\/v1\/private-images\/[^\s"<>]+/)?.[0];

// ---- Flujos ----------------------------------------------------------------
const orden = (fecha, nombre = "Cliente Preview") => ({
  guestCount: "10", tiers: "one", isCustomDesign: "no", hasReferenceImage: "no",
  designDescription: "Torta sencilla de prueba desde Vercel Preview", flavor: "chocolate", theme: "",
  customerName: nombre, email: CLIENTE, phone: "+58 412 0000000", fulfillmentType: "pickup",
  deliveryDetails: "", companyWebsite: "", ...(fecha ? { celebrationDate: fecha } : {}),
});
const formulario = (campos) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
const solicitud = (descripcion, fecha) => formulario({
  customerName: "Cliente Preview", whatsapp: "+58 412 0000000", email: CLIENTE, celebrationDate: fecha,
  celebrationType: "cumpleanos", guestCount: "12", preferredFlavor: "chocolate", cakeDescription: descripcion,
});

async function imagenPorEnlace(owner, esperada, nombre) {
  const url = enlaceFirmado(owner);
  if (!caso(`${nombre}: aviso a la propietaria con enlace firmado`, Boolean(url))) return;
  const r = await fetch(url);
  const cuerpo = Buffer.from(await r.arrayBuffer());
  caso(`${nombre}: descarga por HTTPS público`, r.status === 200 && (r.headers.get("cache-control") ?? "").includes("no-store"),
    `${r.status}, ${cuerpo.length} bytes`);
  caso(`${nombre}: imagen idéntica byte a byte`, cuerpo.length === esperada.length && sha(cuerpo) === sha(esperada));
  const mala = await fetch(url.replace(/sig=[^&]{6}/, "sig=AAAAAA"));
  caso(`${nombre}: firma alterada rechazada`, mala.status !== 200, String(mala.status));
  return { bytes: cuerpo.length, sha256_igual: sha(cuerpo) === sha(esperada) };
}

const T0 = new Date();
const abiertas = new Map(); // code → último token de las reservas de esta corrida
let idsGestion;
async function limpiar() {
  const pendientes = abiertas.size;
  let canceladas = 0;
  for (const [code, token] of [...abiertas]) {
    const g = await idsGestion(code, token);
    if ((await accion(`/agenda/reservas/${code}`, g.cancelManagedReservation, [{ code, token, confirmed: true }])).ok) { canceladas++; abiertas.delete(code); }
  }
  caso("limpieza: ninguna reserva sintética abierta", abiertas.size === 0, `${pendientes} pendientes, ${canceladas} canceladas`);
}
const PASOS = (process.env.FP_PASOS ?? "solicitud,imagen,diseno,agenda,recuperacion,reporte,chat,limpieza,correo").split(",");
const paso = (p) => PASOS.includes(p);
try {
  await esperarTunel();
  for (const m of (await mailpit("/api/v1/messages?limit=500")).messages) vistos.add(m.ID);
  console.log(`Flujos en ${ALIAS} (Mailpit por túnel; ${vistos.size} correos previos ignorados)`);

  const sinSesion = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", ALIAS + "/"], { encoding: "utf8" }).stdout;
  caso("sin sesión: Vercel Authentication", /^30[27] https:\/\/vercel\.com\/sso-api/.test(sinSesion), sinSesion.split(" ")[0]);

  const portada = vercel("/");
  const canonica = portada.cuerpo.toString("utf8").match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    ?? portada.cuerpo.toString("utf8").match(/property="og:url" content="([^"]+)"/)?.[1];
  caso("portada con bypass", portada.estado === 200, `${portada.estado}; canónica ${canonica ?? "no declarada"}`);

  const ids = { ...idsDeAcciones("/"), ...idsDeAcciones("/crea-tu-torta"), ...idsDeAcciones("/agenda"), ...idsDeAcciones("/agenda/recuperar") };
  caso("ids de Server Actions", ["submitCakeRequest", "submitCakeDesign", "fetchAgendaAvailability", "submitAgendaReservation", "requestReservationLinkRecovery"].every((k) => ids[k]),
    Object.keys(ids).sort().join(", "));

  // Disponibilidad real (dos meses) para elegir días libres, lejos de los bordes.
  const libres = [];
  const hoy = new Date();
  for (let k = 0; k < 3 && libres.length < 3; k++) {
    const mes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + k, 1)).toISOString().slice(0, 7);
    const d = await accion("/agenda", ids.fetchAgendaAvailability, [orden(), mes]);
    if (!d.ok) throw new Error(`disponibilidad ${mes}: ${d.message}`);
    libres.push(...d.days.filter((x) => x.canAccept && x.status === "available" && x.capacityRemaining >= 2).map((x) => x.date).filter((f) => f > d.todayISO));
  }
  caso("disponibilidad real desde Preview", libres.length >= 3, `${libres.length} días aceptan`);
  const [d1, d2, d3] = libres.slice(-3);

  // 1. Solicitud con imagen pequeña: correos enviados en after().
  if (paso("solicitud")) {
    const f = solicitud("Solicitud sintética desde Vercel Preview", d1); f.set("referenceImage", new File([PNG], "ref.png", { type: "image/png" }));
    const t0 = Date.now();
    const r = await accion("/", ids.submitCakeRequest, [f]);
    const ms = Date.now() - t0;
    caso("solicitud con imagen: aceptada", r.ok === true, r.message);
    const [c, o] = [await correos(CLIENTE, 1), await correos(PROPIETARIA, 1)];
    caso("solicitud: correo a la clienta y aviso a la propietaria (after())", c.length === 1 && o.length === 1, `${c.length}+${o.length}, respuesta en ${ms} ms`);
    if (o[0]) evidencia.solicitud = await imagenPorEnlace(o[0], PNG, "solicitud");
  }

  // 2. Imagen de exactamente 4.000.000 bytes a través de la función de Vercel.
  if (paso("imagen")) {
    const png = pngExacto(4_000_000);
    const f = solicitud("Imagen de tamaño máximo desde Vercel Preview", d1); f.set("referenceImage", new File([png], "maxima.png", { type: "image/png" }));
    const r = await accion("/", ids.submitCakeRequest, [f]);
    caso("imagen de 4.000.000 bytes: aceptada", r.ok === true, r.message);
    const [c, o] = [await correos(CLIENTE, 1), await correos(PROPIETARIA, 1)];
    caso("imagen máxima: correos", c.length === 1 && o.length === 1, `${c.length}+${o.length}`);
    if (o[0]) evidencia.imagen_maxima = await imagenPorEnlace(o[0], png, "imagen máxima");
    const f2 = solicitud("Imagen de 4.000.001 bytes desde Vercel Preview", d1);
    f2.set("referenceImage", new File([pngExacto(4_000_001)], "excedida.png", { type: "image/png" }));
    const r2 = await accion("/", ids.submitCakeRequest, [f2]);
    caso("imagen de 4.000.001 bytes: rechazada sin guardar", r2.ok === false && (await correos(PROPIETARIA, 1, { segundos: 8 })).length === 0, r2.message);
  }

  // 3. Diseño personalizado.
  if (paso("diseno")) {
    const f = formulario({ customerName: "Cliente Preview", whatsapp: "+58 412 0000000", email: CLIENTE, eventDate: d1, guestCount: "10", zone: "Centro",
      design: JSON.stringify({ version: 1, tiers: 1, baseVariant: "one-tier-cream", standVariant: "stand-blush", plaqueVariant: null, message: "", topperVariant: null }) });
    const r = await accion("/crea-tu-torta", ids.submitCakeDesign, [f]);
    caso("diseño personalizado: aceptado", r.ok === true, r.message);
    const [c, o] = [await correos(CLIENTE, 1), await correos(PROPIETARIA, 1)];
    caso("diseño: correos (after())", c.length === 1 && o.length === 1, `${c.length}+${o.length}`);
  }

  // 4. Agenda: reserva, enlace privado, token inválido, reprogramación, cancelación.
  let gestion;
  idsGestion = async (code, token) => (gestion ??= { ...ids, ...idsDeAcciones(`/agenda/reservas/${code}?token=${encodeURIComponent(token)}`) });
  if (paso("agenda")) {
    const r = await accion("/agenda", ids.submitAgendaReservation, [orden(d1)]);
    caso("agenda: reserva", r.ok === true, r.ok ? `${r.status ?? "creada"}` : r.message);
    const c = await correos(CLIENTE, 1), o = await correos(PROPIETARIA, 1);
    caso("agenda: correo con enlace privado y aviso a la propietaria (after())", c.length === 1 && o.length === 1, `${c.length}+${o.length}`);
    const { origen, token } = enlaceGestion(c[0], r.code);
    abiertas.set(r.code, token);
    caso("agenda: el enlace usa el origen canónico de la Preview", origen === ALIAS, origen === ALIAS ? "alias de rama" : "otro origen");
    const buena = vercel(`/agenda/reservas/${r.code}?token=${encodeURIComponent(token)}`);
    caso("agenda: la página privada abre con el token", buena.estado === 200 && buena.cuerpo.toString("utf8").includes(r.code), String(buena.estado));
    await idsGestion(r.code, token);
    const pag = `/agenda/reservas/${r.code}`;
    const consulta = (t) => accion(pag, gestion.fetchRescheduleAvailability, [{ code: r.code, token: t, monthISO: d2.slice(0, 7) }]);
    caso("agenda: el token abre la reserva (consulta de reprogramación)", (await consulta(token)).ok === true);
    const invalido = await consulta("x".repeat(43));
    caso("agenda: token inválido rechazado", invalido.ok === false, invalido.message);
    const mov = await accion(pag, gestion.rescheduleManagedReservation, [{ code: r.code, token, newDate: d2, confirmed: true }]);
    caso("agenda: reprogramación", mov.ok === true, mov.ok ? mov.reservation?.celebrationDate === d2 ? "nueva fecha" : "ok" : mov.message);
    const can = await accion(pag, gestion.cancelManagedReservation, [{ code: r.code, token, confirmed: true }]);
    caso("agenda: cancelación", can.ok === true && can.reservation?.status === "cancelled", can.ok ? can.reservation?.status : can.message);
    if (can.ok) abiertas.delete(r.code);
    evidencia.agenda = { reserva: true, enlace_canonico: origen === ALIAS, reprogramada: mov.ok, cancelada: can.ok };
  }

  // 5. Recuperación del enlace: solo al correo guardado; el token nuevo rota el anterior.
  if (paso("recuperacion")) {
    const r = await accion("/agenda", ids.submitAgendaReservation, [orden(d3)]);
    caso("recuperación: reserva previa", r.ok === true, r.ok ? "" : r.message);
    const viejo = enlaceGestion((await correos(CLIENTE, 1))[0], r.code).token;
    caso("recuperación: aviso de la reserva a la propietaria", (await correos(PROPIETARIA, 1)).length === 1);
    abiertas.set(r.code, viejo);
    await idsGestion(r.code, viejo);
    const ajeno = await accion("/agenda/recuperar", ids.requestReservationLinkRecovery, [formulario({ code: r.code, email: "otra.preview@example.invalid" })]);
    const sinCorreo = (await correos(CLIENTE, 1, { segundos: 10 })).length === 0 && (await correos("otra.preview@example.invalid", 1, { segundos: 2 })).length === 0;
    caso("recuperación: correo ajeno no envía nada", sinCorreo);
    const propio = await accion("/agenda/recuperar", ids.requestReservationLinkRecovery, [formulario({ code: r.code, email: CLIENTE })]);
    caso("recuperación: misma respuesta en ambos casos", propio.message === ajeno.message);
    const rec = await correos(CLIENTE, 1);
    caso("recuperación: un correo con enlace nuevo (after())", rec.length === 1);
    const nuevo = enlaceGestion(rec[0], r.code).token;
    abiertas.set(r.code, nuevo);
    const consulta = (t) => accion(`/agenda/reservas/${r.code}`, gestion.fetchRescheduleAvailability, [{ code: r.code, token: t, monthISO: d3.slice(0, 7) }]);
    caso("recuperación: el token nuevo abre la reserva", nuevo !== viejo && (await consulta(nuevo)).ok === true);
    caso("recuperación: el token anterior queda rotado", (await consulta(viejo)).ok === false);
    // Deja la reserva cancelada para no ocupar cupo.
    const can = await accion(`/agenda/reservas/${r.code}`, gestion.cancelManagedReservation, [{ code: r.code, token: nuevo, confirmed: true }]);
    caso("recuperación: reserva sintética cancelada al final", can.ok === true);
    if (can.ok) abiertas.delete(r.code);
  }

  // 6. Reporte semanal manual (CRON_SECRET propio de Preview), determinista sin Gemini.
  if (paso("reporte")) {
    const sin = vercel("/api/reports/weekly?trigger=manual");
    caso("reporte: sin CRON_SECRET → 401", sin.estado === 401, String(sin.estado));
    const secreto = readFileSync(join(SECRETOS, "vercel-preview-cron-secret"), "utf8").trim();
    const con = vercel("/api/reports/weekly?trigger=manual", { cabeceras: { Authorization: `Bearer ${secreto}` } });
    const j = JSON.parse(con.cuerpo.toString("utf8") || "{}");
    caso("reporte: manual con CRON_SECRET", con.estado === 200 && j.ok === true, `${con.estado} ${j.status ?? ""}`);
    if (j.status === "sent") caso("reporte: correo a la propietaria", (await correos(PROPIETARIA, 1)).length === 1);
  }

  // 7. Chat sin Gemini: debe fallar de forma visible, sin llamadas a Gemini.
  if (paso("chat")) {
    const r = vercel("/api/assistant", { metodo: "POST", cabeceras: { "Content-Type": "application/json", Origin: ALIAS }, cuerpo: JSON.stringify({ message: "¿Hacen tortas de chocolate?", history: [] }) });
    evidencia.chat = { estado: r.estado, mensaje: (() => { try { return JSON.parse(r.cuerpo.toString("utf8")).error; } catch { return null; } })() };
    caso("chat sin GEMINI_API_KEY: error visible, no respuesta inventada", r.estado >= 500, `${r.estado} «${evidencia.chat.mensaje}»`);
    const ag = vercel("/api/agent", { metodo: "POST", cabeceras: { "Content-Type": "application/json", Origin: ALIAS }, cuerpo: JSON.stringify({ message: "Hola, quiero una torta para 20 personas el sábado" }) });
    evidencia.agente = ag.estado;
    console.log(`   info agente (/api/agent): HTTP ${ag.estado}`);
  }

  // 8. Limpieza: cancela las reservas sintéticas que esta corrida dejó abiertas
  // (p. ej. si un paso falló entre la reserva y su cancelación).
  if (paso("limpieza")) await limpiar();

  // 9. Todo el correo de esta corrida: solo .invalid.
  if (paso("correo")) {
    const d = await mailpit("/api/v1/messages?limit=500");
    const todos = d.messages.filter((m) => new Date(m.Created) >= T0);
    const dominios = [...new Set(todos.flatMap((m) => [...m.To, ...(m.Cc ?? []), ...(m.Bcc ?? [])].map((t) => t.Address.split("@")[1])))];
    caso("correo de la corrida: solo @example.invalid", todos.length > 0 && dominios.every((x) => x === "example.invalid"), `${todos.length} correos, ${dominios.join(", ")}`);
    evidencia.correos = todos.length;
  }
} catch (e) {
  caso("ejecución", false, `${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""} en ${(e.stack ?? "").split("\n").find((l) => l.includes("flujos-preview")) ?? "?"}`.trim());
} finally {
  if (abiertas.size && idsGestion) { try { await limpiar(); } catch (e) { caso("limpieza tras el fallo", false, e.message); } }
  tunel.kill();
  rmSync(TMP, { recursive: true, force: true });
}
const ok = resultados.filter(Boolean).length;
console.log(`${ok}/${resultados.length} comprobaciones; evidencia ${JSON.stringify(evidencia)}`);
process.exit(ok === resultados.length ? 0 : 1);

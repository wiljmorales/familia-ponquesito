/**
 * Reto 8 — verificación REAL de la garantía anti-sobreventa de
 * reserve_production_slot contra el Supabase del proyecto.
 *
 * Qué hace:
 *   1. Elige una fecha futura de demostración (hoy del negocio + 45 días).
 *   2. Prepara un override para que quede EXACTAMENTE 1 punto libre.
 *   3. Lanza dos llamadas simultáneas al RPC pidiendo 1 punto cada una.
 *   4. Verifica que una gana y la otra recibe capacity_unavailable.
 *   5. Verifica que la capacidad nunca se excedió.
 *   6. Limpia todos sus datos en un bloque finally (pase lo que pase).
 *
 * Cómo ejecutarlo (después de aplicar la sección Reto 8 de schema.sql):
 *   node --env-file=.env.local --experimental-strip-types scripts/verify-agenda-concurrency.ts
 *   (o `npm run verify:agenda-concurrency`)
 *
 * Termina con código distinto de cero si alguna aserción falla. Llama a
 * los RPC directamente: NO envía correos ni dispara processLead(); prueba
 * la garantía de concurrencia de la base de datos, nada más. Todos los
 * datos que crea están inequívocamente marcados como demostración y jamás
 * usa una fecha con reservas reales (aborta si las encuentra).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Día calendario del negocio (America/Caracas) + suma de días. Copia
// mínima de src/lib/business-dates.ts: el script se ejecuta con Node
// directamente (sin el alias @/ del bundler), así que no importa desde src/.
function businessTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const DEMO_DATE = addDaysISO(businessTodayISO(), 45);
const DEMO_NOTE = "Reto 8 — verificación de concurrencia (demo)";
const DEMO_CODES = ["FP-8-CCA1", "FP-8-CCA2"];

interface AvailabilityRow {
  business_date: string;
  capacity_total: number;
  capacity_used: number;
  capacity_remaining: number;
  is_blocked: boolean;
  can_accept: boolean;
}

interface ReservationRpcResult {
  ok: boolean;
  error?: string;
  capacity_total?: number;
  capacity_used?: number;
  capacity_remaining?: number;
}

function fail(message: string): never {
  throw new Error(`ASERCIÓN FALLIDA: ${message}`);
}

async function getDayAvailability(supabase: SupabaseClient): Promise<AvailabilityRow> {
  const { data, error } = await supabase.rpc("get_production_availability", {
    p_start_date: DEMO_DATE,
    p_end_date: DEMO_DATE,
    p_capacity_points: 1,
  });
  if (error || !data?.length) {
    throw new Error(`get_production_availability falló: ${error?.message ?? "sin filas"}`);
  }
  return data[0] as AvailabilityRow;
}

function reserveDemoSlot(supabase: SupabaseClient, code: string) {
  return supabase.rpc("reserve_production_slot", {
    p_celebration_date: DEMO_DATE,
    p_capacity_points: 1,
    p_code: code,
    // Hash con forma válida pero sin token real detrás: nadie puede
    // gestionar estas reservas de demostración, y se borran al final.
    p_manage_token_hash: randomBytes(32).toString("hex"),
    p_status: "pending_deposit",
    p_customer_name: DEMO_NOTE,
    p_customer_email: "stage2-agenda-demo@example.com",
    p_customer_phone: "0412-0000000",
    p_guest_count: 10,
    p_flavor: "Chocolate (demo)",
    p_theme: null,
    p_fulfillment_type: "pickup",
    p_delivery_details: null,
    p_reference_image_path: null,
    p_order_details: { demo: true, source: "verify-agenda-concurrency" },
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. " +
        "Ejecuta con: node --env-file=.env.local --experimental-strip-types scripts/verify-agenda-concurrency.ts",
    );
    process.exitCode = 1;
    return;
  }
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  // Si la fecha de demo ya tiene reservas (¿reales?), abortamos: este
  // script solo trabaja sobre un día que puede controlar por completo.
  const { data: existing, error: existingError } = await supabase
    .from("cake_reservations")
    .select("id")
    .eq("celebration_date", DEMO_DATE)
    .limit(1);
  if (existingError) throw new Error(`No se pudo inspeccionar la fecha de demo: ${existingError.message}`);
  if (existing && existing.length > 0) {
    fail(`la fecha de demo ${DEMO_DATE} ya tiene reservas; no se toca. Ajusta el offset y reintenta.`);
  }

  let overrideCreated = false;
  try {
    // Deja EXACTAMENTE 1 punto libre (capacidad total 1, sin reservas).
    const { error: overrideError } = await supabase
      .from("production_day_overrides")
      .insert({ business_date: DEMO_DATE, capacity_total: 1, internal_note: DEMO_NOTE });
    if (overrideError) {
      throw new Error(
        `No se pudo crear el override de demo (¿ya existe un override real para ${DEMO_DATE}?): ${overrideError.message}`,
      );
    }
    overrideCreated = true;

    const before = await getDayAvailability(supabase);
    if (before.capacity_remaining !== 1 || !before.can_accept) {
      fail(`se esperaba exactamente 1 punto libre en ${DEMO_DATE}; hay ${JSON.stringify(before)}`);
    }

    // Dos intentos SIMULTÁNEOS por el último punto.
    console.log(`Lanzando 2 reservas simultáneas por el último punto de ${DEMO_DATE}…`);
    const [first, second] = await Promise.all(DEMO_CODES.map((code) => reserveDemoSlot(supabase, code)));

    for (const response of [first, second]) {
      if (response.error || response.data == null) {
        throw new Error(`reserve_production_slot falló a nivel de transporte: ${response.error?.message}`);
      }
    }
    const results = [first.data, second.data] as ReservationRpcResult[];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);

    if (winners.length !== 1) {
      fail(`debía ganar exactamente 1 reserva; ganaron ${winners.length}: ${JSON.stringify(results)}`);
    }
    if (losers.length !== 1 || losers[0].error !== "capacity_unavailable") {
      fail(`la perdedora debía recibir capacity_unavailable; llegó ${JSON.stringify(losers)}`);
    }
    const winner = winners[0];
    if (
      winner.capacity_total !== 1 ||
      winner.capacity_used !== 1 ||
      winner.capacity_remaining !== 0
    ) {
      fail(`la ganadora debía devolver capacidad total/usada/restante = 1/1/0; llegó ${JSON.stringify(winner)}`);
    }
    if (winner.capacity_remaining !== winner.capacity_total - winner.capacity_used) {
      fail(`la ganadora devolvió una fotografía de capacidad incoherente: ${JSON.stringify(winner)}`);
    }

    const after = await getDayAvailability(supabase);
    if (after.capacity_used > after.capacity_total) {
      fail(`SOBREVENTA: usado=${after.capacity_used} > total=${after.capacity_total}`);
    }
    if (after.capacity_used !== 1 || after.capacity_remaining !== 0 || after.can_accept) {
      fail(`estado final inesperado del día: ${JSON.stringify(after)}`);
    }

    console.log("✔ Una sola reserva ganó; la otra recibió capacity_unavailable.");
    console.log("✔ La ganadora devolvió capacidad transaccional total/usada/restante = 1/1/0.");
    console.log(`✔ Capacidad final del día: usado=${after.capacity_used} / total=${after.capacity_total} (sin sobreventa).`);
    console.log("VERIFICACIÓN DE CONCURRENCIA: OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    // Limpieza SIEMPRE, aunque una aserción haya fallado. Borrar la
    // reserva elimina en cascada sus reservation_events.
    const { error: cleanupReservations } = await supabase
      .from("cake_reservations")
      .delete()
      .in("code", DEMO_CODES);
    if (cleanupReservations) {
      console.error(`LIMPIEZA INCOMPLETA (reservas): ${cleanupReservations.message}`);
      process.exitCode = 1;
    }
    if (overrideCreated) {
      const { error: cleanupOverride } = await supabase
        .from("production_day_overrides")
        .delete()
        .eq("business_date", DEMO_DATE)
        .eq("internal_note", DEMO_NOTE);
      if (cleanupOverride) {
        console.error(`LIMPIEZA INCOMPLETA (override): ${cleanupOverride.message}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

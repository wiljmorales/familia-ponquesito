import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import {
  BOOKING_WINDOW_DAYS,
  COMPLEX_CAKE_POINTS,
  CUSTOM_CAKE_POINTS,
  DEFAULT_DAILY_CAPACITY,
  SIMPLE_CAKE_POINTS,
} from "./capacity";
import {
  CAPACITY_CONSUMING_STATUSES,
  MODIFIABLE_RESERVATION_STATUSES,
  RESERVATION_STATUSES,
} from "./types";

/**
 * Guardia de alineación SQL ↔ TypeScript (Reto 8). La autoridad en tiempo
 * de ejecución son los helpers agenda_* de supabase/schema.sql; las
 * constantes TS son espejos para la UI y la validación temprana. Si este
 * test falla, alguien cambió un lado sin el otro: corrige ambos.
 */

const schema = readFileSync(
  new URL("../../supabase/schema.sql", import.meta.url),
  "utf8",
);

// Limita las búsquedas a la sección del Reto 8 (otras tablas también
// tienen columnas status/checks similares).
const reto8Start = schema.indexOf('Reto 8: "Agenda Ponquesito"');
const reto8 = schema.slice(reto8Start);

function sqlHelperValue(name: string): number {
  const match = reto8.match(
    new RegExp(
      `create or replace function public\\.${name}\\(\\)\\s*` +
        `returns integer\\s*language sql immutable\\s*as \\$\\$ select (\\d+) \\$\\$;`,
    ),
  );
  if (!match) throw new Error(`No se encontró el helper SQL ${name}()`);
  return Number(match[1]);
}

describe("alineación supabase/schema.sql ↔ constantes TypeScript", () => {
  it("la sección del Reto 8 existe en el esquema", () => {
    expect(reto8Start).toBeGreaterThan(-1);
  });

  it("agenda_default_capacity() = DEFAULT_DAILY_CAPACITY", () => {
    expect(sqlHelperValue("agenda_default_capacity")).toBe(DEFAULT_DAILY_CAPACITY);
  });

  it("agenda_min_lead_days() = MIN_LEAD_DAYS", () => {
    expect(sqlHelperValue("agenda_min_lead_days")).toBe(MIN_LEAD_DAYS);
  });

  it("agenda_booking_window_days() = BOOKING_WINDOW_DAYS", () => {
    expect(sqlHelperValue("agenda_booking_window_days")).toBe(BOOKING_WINDOW_DAYS);
  });

  it("agenda_capacity_consuming_statuses() = CAPACITY_CONSUMING_STATUSES", () => {
    const match = reto8.match(
      /agenda_capacity_consuming_statuses\(\)\s*returns text\[\]\s*language sql immutable\s*as \$\$ select array\[([^\]]+)\]::text\[\] \$\$;/,
    );
    expect(match).not.toBeNull();
    const sqlStatuses = match![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(sqlStatuses).toEqual([...CAPACITY_CONSUMING_STATUSES]);
  });

  it("el check de capacity_points coincide con los puntos por complejidad", () => {
    const match = reto8.match(/check \(capacity_points in \((\d), (\d), (\d)\)\)/);
    expect(match).not.toBeNull();
    expect(match!.slice(1, 4).map(Number)).toEqual([
      SIMPLE_CAKE_POINTS,
      CUSTOM_CAKE_POINTS,
      COMPLEX_CAKE_POINTS,
    ]);
  });

  it("el check de status de cake_reservations coincide con RESERVATION_STATUSES", () => {
    const match = reto8.match(/status in \(([^)]+)\)/);
    expect(match).not.toBeNull();
    const sqlStatuses = match![1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(sqlStatuses).toEqual([...RESERVATION_STATUSES]);
  });

  it("manage_token_hash exige SHA-256 hex tanto en la tabla como en el RPC", () => {
    expect(reto8).toContain("manage_token_hash ~ '^[0-9a-f]{64}$'");
    expect(reto8).toContain("p_manage_token_hash !~ '^[0-9a-f]{64}$'");
  });

  it("la tabla impone coherencia entre cancelled_at y status = 'cancelled'", () => {
    expect(reto8).toContain("constraint cake_reservations_cancelled_at_coherence check");
    expect(reto8).toContain("(status = 'cancelled') = (cancelled_at is not null)");
  });

  it("delivery exige detalles de entrega en la tabla y en el RPC", () => {
    expect(reto8).toContain("constraint cake_reservations_delivery_details_required check");
    expect(reto8).toContain(
      "(p_fulfillment_type = 'delivery' and nullif(trim(p_delivery_details), '') is null)",
    );
  });

  it("los datos esenciales de texto rechazan valores de solo espacios", () => {
    for (const column of ["code", "customer_name", "customer_email", "customer_phone", "flavor"]) {
      expect(reto8).toContain(`check (btrim(${column}) <> '')`);
    }
  });

  it("reservation_events deduplica solo eventos terminales con clave", () => {
    expect(reto8).toContain("add column if not exists dedupe_key text");
    expect(reto8).toContain("create unique index if not exists reservation_events_dedupe_idx");
    expect(reto8).toContain("on public.reservation_events (reservation_id, dedupe_key)");
    expect(reto8).toContain("where dedupe_key is not null");
  });

  it("reserve_production_slot devuelve la fotografía transaccional de capacidad", () => {
    expect(reto8).toContain("'capacity_total', v_capacity_total");
    expect(reto8).toContain("'capacity_used',");
    expect(reto8).toContain("'capacity_remaining',");
  });

  it("lookup privado exige código + hash y no proyecta campos internos", () => {
    const start = reto8.indexOf("create or replace function public.get_cake_reservation");
    const end = reto8.indexOf("-- Reprogramación atómica", start);
    const lookup = reto8.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(lookup).toContain("r.code = trim(p_code)");
    expect(lookup).toContain("r.manage_token_hash = p_manage_token_hash");
    for (const forbidden of [
      "'reservation_id'",
      "'manage_token_hash'",
      "'order_details'",
      "'reference_image_path'",
      "'customer_email'",
      "'customer_phone'",
    ]) {
      expect(lookup).not.toContain(forbidden);
    }
  });

  it("los estados modificables coinciden en lookup, reprogramación y cancelación", () => {
    const sqlList = MODIFIABLE_RESERVATION_STATUSES.map((status) => `'${status}'`).join(", ");
    expect(reto8.match(new RegExp(`in \\(${sqlList}\\)`, "g"))).toHaveLength(3);
  });

  it("los RPC privados de Etapa 5 solo se conceden a service_role", () => {
    for (const signature of [
      "get_cake_reservation(text, text)",
      "reschedule_cake_reservation(text, text, date)",
      "cancel_cake_reservation(text, text)",
    ]) {
      expect(reto8).toContain(
        `revoke execute on function public.${signature} from public, anon, authenticated`,
      );
      expect(reto8).toContain(
        `grant execute on function public.${signature} to service_role`,
      );
    }
  });
});

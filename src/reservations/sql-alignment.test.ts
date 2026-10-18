import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import { BOOKING_WINDOW_DAYS, DEFAULT_DAILY_CAPACITY } from "./capacity";
import { CAPACITY_CONSUMING_STATUSES, MODIFIABLE_RESERVATION_STATUSES, RESERVATION_STATUSES } from "./types";

/** Verifica que los espejos de UI sigan el servicio Django, autoridad final. */
const reservations = readFileSync(new URL("../../backend/commerce/reservations.py", import.meta.url), "utf8");
const models = readFileSync(new URL("../../backend/commerce/models.py", import.meta.url), "utf8");

function integerConstant(name: string): number {
  const match = reservations.match(new RegExp(`^${name} = (\\d+)$`, "m"));
  if (!match) throw new Error(`Falta ${name} en Django`);
  return Number(match[1]);
}

describe("alineación Django/PostgreSQL ↔ constantes TypeScript", () => {
  it("capacidad y ventana de agenda", () => {
    expect(integerConstant("DEFAULT_CAPACITY")).toBe(DEFAULT_DAILY_CAPACITY);
    expect(integerConstant("MIN_LEAD_DAYS")).toBe(MIN_LEAD_DAYS);
    expect(integerConstant("BOOKING_WINDOW_DAYS")).toBe(BOOKING_WINDOW_DAYS);
  });

  it("estados y puntos", () => {
    for (const status of RESERVATION_STATUSES) expect(models).toContain(`"${status}"`);
    expect(reservations).toContain(`CONSUMING = (${CAPACITY_CONSUMING_STATUSES.map((s) => `"${s}"`).join(", ")})`);
    expect(reservations).toContain(`MODIFIABLE = (${MODIFIABLE_RESERVATION_STATUSES.map((s) => `"${s}"`).join(", ")})`);
    expect(models).toContain("Q(capacity_points__in=[1, 2, 3])");
  });

  it("la capacidad se protege en PostgreSQL y el lookup no publica secretos", () => {
    expect(reservations).toContain("pg_advisory_xact_lock");
    expect(reservations).toContain("@transaction.atomic");
    const publicView = reservations.split("def public_reservation(reservation):")[1]?.split("@transaction.atomic")[0];
    expect(publicView).toBeDefined();
    for (const privateField of ['"manage_token_hash":', '"customer_email":', '"customer_phone":', '"order_details":']) {
      expect(publicView).not.toContain(privateField);
    }
  });
});

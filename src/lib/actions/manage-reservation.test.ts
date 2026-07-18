import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import {
  cancelManagedReservation,
  fetchRescheduleAvailability,
  rescheduleManagedReservation,
  type ManageActionDeps,
} from "./manage-reservation";
import type { PublicReservation } from "@/reservations/types";

const reservation: PublicReservation = {
  code: "FP-8-K7M2",
  celebrationDate: "2026-08-10",
  status: "pending_deposit",
  customerName: "Ana",
  guestCount: 20,
  flavor: "Chocolate",
  theme: "Flores",
  fulfillmentType: "pickup",
  createdAt: "2026-07-18T12:00:00Z",
  capacityPoints: 2,
  canReschedule: true,
  canCancel: true,
};

function deps(overrides: Partial<ManageActionDeps> = {}): Partial<ManageActionDeps> {
  return {
    lookupReservationFn: vi.fn(async () => ({ ok: true as const, reservation })),
    getAvailabilityFn: vi.fn(async () => ({
      ok: true as const,
      days: [
        {
          business_date: "2026-08-12",
          capacity_total: 4,
          capacity_used: 1,
          capacity_remaining: 3,
          is_blocked: false,
          can_accept: true,
        },
      ],
    })),
    rescheduleReservationFn: vi.fn(async () => ({
      ok: true as const,
      reservationId: "internal-id",
      code: reservation.code,
      status: reservation.status,
      previousDate: reservation.celebrationDate,
      newDate: "2026-08-12",
    })),
    cancelReservationFn: vi.fn(async () => ({
      ok: true as const,
      reservationId: "internal-id",
      code: reservation.code,
      status: "cancelled" as const,
      celebrationDate: reservation.celebrationDate,
    })),
    businessTodayISOFn: () => "2026-07-18",
    isModificationAllowedFn: async () => true,
    ...overrides,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("fetchRescheduleAvailability", () => {
  it("deriva los puntos desde la reserva y nunca desde el navegador", async () => {
    const testDeps = deps();
    const result = await fetchRescheduleAvailability(
      { code: reservation.code, token: "x".repeat(32), monthISO: "2026-08", capacityPoints: 1 },
      testDeps,
    );

    expect(result).toMatchObject({ ok: true, currentDate: "2026-08-10" });
    expect(testDeps.getAvailabilityFn).toHaveBeenCalledWith("2026-08-01", "2026-08-31", 2);
    expect(JSON.stringify(result)).not.toContain("x".repeat(32));
  });

  it("mantiene anti-enumeración para credenciales inválidas", async () => {
    const invalid = deps({
      lookupReservationFn: vi.fn(async () => ({
        ok: false as const,
        error: "reservation_not_found" as const,
      })),
    });
    const byCode = await fetchRescheduleAvailability(
      { code: "FP-8-NOPE", token: "x".repeat(32), monthISO: "2026-08" },
      invalid,
    );
    const byToken = await fetchRescheduleAvailability(
      { code: reservation.code, token: "y".repeat(32), monthISO: "2026-08" },
      invalid,
    );
    expect(byCode).toEqual(byToken);
  });
});

describe("rescheduleManagedReservation", () => {
  it("exige confirmación explícita", async () => {
    const testDeps = deps();
    const result = await rescheduleManagedReservation(
      { code: reservation.code, token: "x".repeat(32), newDate: "2026-08-12", confirmed: false },
      testDeps,
    );
    expect(result.ok).toBe(false);
    expect(testDeps.rescheduleReservationFn).not.toHaveBeenCalled();
  });

  it("devuelve estado posterior seguro y no devuelve token ni id interno", async () => {
    const updated = { ...reservation, celebrationDate: "2026-08-12" };
    const result = await rescheduleManagedReservation(
      { code: reservation.code, token: "x".repeat(32), newDate: "2026-08-12", confirmed: true },
      deps({
        lookupReservationFn: vi.fn(async () => ({
          ok: true as const,
          reservation: updated,
        })),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      reservation: { code: reservation.code, celebrationDate: "2026-08-12" },
    });
    expect(JSON.stringify(result)).not.toContain("x".repeat(32));
    expect(JSON.stringify(result)).not.toContain("internal-id");
  });

  it.each([
    ["same_date", "diferente"],
    ["capacity_unavailable", "capacidad"],
    ["date_blocked", "horneando"],
    ["too_soon", "tres días"],
    ["out_of_window", "60 días"],
    ["change_window_closed", "demasiado cerca"],
    ["status_not_modifiable", "estado actual"],
    ["reservation_not_found", "enlace"],
  ] as const)("traduce %s sin filtrar datos internos", async (error, fragment) => {
    const result = await rescheduleManagedReservation(
      { code: reservation.code, token: "x".repeat(32), newDate: "2026-08-12", confirmed: true },
      deps({ rescheduleReservationFn: vi.fn(async () => ({ ok: false as const, error })) }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.message).toContain(fragment);
  });

  it("explica human_review sin afirmar que reservó capacidad", async () => {
    const result = await rescheduleManagedReservation(
      { code: reservation.code, token: "x".repeat(32), newDate: "2026-08-12", confirmed: true },
      deps({
        rescheduleReservationFn: vi.fn(async () => ({
          ok: true as const,
          reservationId: "id",
          code: reservation.code,
          status: "human_review" as const,
          newDate: "2026-08-12",
        })),
      }),
    );
    expect(result.ok && result.message).toContain("aún no está reservada");
  });

  it("aplica rate limit antes de mutar", async () => {
    const testDeps = deps({ isModificationAllowedFn: async () => false });
    const result = await rescheduleManagedReservation(
      { code: reservation.code, token: "x".repeat(32), newDate: "2026-08-12", confirmed: true },
      testDeps,
    );
    expect(result).toMatchObject({ ok: false });
    expect(testDeps.rescheduleReservationFn).not.toHaveBeenCalled();
  });
});

describe("cancelManagedReservation", () => {
  it("exige confirmación explícita y no devuelve credenciales", async () => {
    const testDeps = deps();
    const rejected = await cancelManagedReservation(
      { code: reservation.code, token: "x".repeat(32), confirmed: false },
      testDeps,
    );
    expect(rejected.ok).toBe(false);
    expect(testDeps.cancelReservationFn).not.toHaveBeenCalled();

    const success = await cancelManagedReservation(
      { code: reservation.code, token: "x".repeat(32), confirmed: true },
      deps({
        lookupReservationFn: vi.fn(async () => ({
          ok: true as const,
          reservation: {
            ...reservation,
            status: "cancelled" as const,
            canCancel: false,
            canReschedule: false,
          },
        })),
      }),
    );
    expect(success).toMatchObject({
      ok: true,
      reservation: { code: reservation.code, status: "cancelled", canCancel: false },
    });
    expect(JSON.stringify(success)).not.toContain("x".repeat(32));
  });

  it("mantiene errores seguros y rate limit", async () => {
    const limited = deps({ isModificationAllowedFn: async () => false });
    await cancelManagedReservation(
      { code: reservation.code, token: "x".repeat(32), confirmed: true },
      limited,
    );
    expect(limited.cancelReservationFn).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { findNearbyAlternatives, toDayAvailability } from "./availability";
import type { AvailabilityRow, DayAvailability } from "./types";

const TODAY = "2026-07-18";
const MIN_DATE = "2026-07-21"; // hoy + 3 (MIN_LEAD_DAYS)
const MAX_DATE = "2026-09-16"; // hoy + 60 (BOOKING_WINDOW_DAYS)

function row(overrides: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    business_date: "2026-08-01",
    capacity_total: 4,
    capacity_used: 0,
    capacity_remaining: 4,
    is_blocked: false,
    can_accept: true,
    ...overrides,
  };
}

describe("toDayAvailability", () => {
  it("marca como disponible un día con cupo holgado", () => {
    const day = toDayAvailability(row(), { todayISO: TODAY, points: 1 });
    expect(day.status).toBe("available");
    expect(day.canAccept).toBe(true);
    expect(day.isLastSlot).toBe(false);
  });

  it("marca 'low' cuando tras reservar quedaría poco cupo", () => {
    // 4 libres - 2 del pedido = 2 restantes > 1 → available;
    // 3 libres - 2 del pedido = 1 restante ≤ 1 → low.
    const available = toDayAvailability(row({ capacity_remaining: 4, capacity_used: 0 }), {
      todayISO: TODAY,
      points: 2,
    });
    const low = toDayAvailability(row({ capacity_remaining: 3, capacity_used: 1 }), {
      todayISO: TODAY,
      points: 2,
    });
    expect(available.status).toBe("available");
    expect(low.status).toBe("low");
  });

  it("marca isLastSlot cuando el pedido consumiría exactamente el cupo restante", () => {
    const day = toDayAvailability(row({ capacity_remaining: 2, capacity_used: 2 }), {
      todayISO: TODAY,
      points: 2,
    });
    expect(day.status).toBe("low");
    expect(day.isLastSlot).toBe(true);
  });

  it("marca 'full' un día dentro de la ventana que no acepta por capacidad", () => {
    const day = toDayAvailability(
      row({ capacity_remaining: 1, capacity_used: 3, can_accept: false }),
      { todayISO: TODAY, points: 2 },
    );
    expect(day.status).toBe("full");
    expect(day.canAccept).toBe(false);
    expect(day.isLastSlot).toBe(false);
  });

  it("marca 'blocked' con prioridad sobre cualquier otro estado", () => {
    const day = toDayAvailability(
      row({ business_date: "2026-07-19", is_blocked: true, can_accept: false }),
      { todayISO: TODAY, points: 1 },
    );
    expect(day.status).toBe("blocked");
  });

  it("marca 'too_soon' los días antes de la anticipación mínima", () => {
    const tooSoon = toDayAvailability(
      row({ business_date: "2026-07-20", can_accept: false }),
      { todayISO: TODAY, points: 1 },
    );
    const firstAllowed = toDayAvailability(row({ business_date: MIN_DATE }), {
      todayISO: TODAY,
      points: 1,
    });
    expect(tooSoon.status).toBe("too_soon");
    expect(firstAllowed.status).toBe("available");
  });

  it("marca 'out_of_window' los días después de la ventana de reserva", () => {
    const lastAllowed = toDayAvailability(row({ business_date: MAX_DATE }), {
      todayISO: TODAY,
      points: 1,
    });
    const outOfWindow = toDayAvailability(
      row({ business_date: "2026-09-17", can_accept: false }),
      { todayISO: TODAY, points: 1 },
    );
    expect(lastAllowed.status).toBe("available");
    expect(outOfWindow.status).toBe("out_of_window");
  });
});

function day(date: string, canAccept = true): DayAvailability {
  return { date, status: canAccept ? "available" : "full", canAccept, capacityRemaining: 4, isLastSlot: false };
}

describe("findNearbyAlternatives", () => {
  it("devuelve máximo 3 alternativas que aceptan el pedido, sin la fecha pedida", () => {
    const days = [
      day("2026-08-01"),
      day("2026-08-02"),
      day("2026-08-03"),
      day("2026-08-04"),
      day("2026-08-05"),
    ];
    const alternatives = findNearbyAlternatives(days, "2026-08-03");
    expect(alternatives).toHaveLength(3);
    expect(alternatives.map((d) => d.date)).not.toContain("2026-08-03");
  });

  it("ordena por cercanía y en empate prefiere la fecha posterior", () => {
    const days = [day("2026-08-01"), day("2026-08-02"), day("2026-08-04"), day("2026-08-05")];
    const alternatives = findNearbyAlternatives(days, "2026-08-03");
    // Distancias: 08-02 y 08-04 a 1 día (gana la posterior), 08-01 y 08-05
    // a 2 días (gana la posterior).
    expect(alternatives.map((d) => d.date)).toEqual(["2026-08-04", "2026-08-02", "2026-08-05"]);
  });

  it("excluye los días que no aceptan el pedido", () => {
    const days = [
      day("2026-08-02", false),
      day("2026-08-04"),
      day("2026-08-05", false),
      day("2026-08-06"),
    ];
    const alternatives = findNearbyAlternatives(days, "2026-08-03");
    expect(alternatives.map((d) => d.date)).toEqual(["2026-08-04", "2026-08-06"]);
  });

  it("devuelve vacío cuando ningún día acepta", () => {
    const days = [day("2026-08-02", false), day("2026-08-04", false)];
    expect(findNearbyAlternatives(days, "2026-08-03")).toEqual([]);
  });
});

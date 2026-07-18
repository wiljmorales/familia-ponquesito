import { describe, expect, it } from "vitest";
import { addDaysISO, businessTodayISO, daysBetweenISO } from "./business-dates";

describe("addDaysISO", () => {
  it("suma días dentro del mismo mes", () => {
    expect(addDaysISO("2026-03-10", 5)).toBe("2026-03-15");
  });

  it("cruza mes y año correctamente", () => {
    expect(addDaysISO("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDaysISO("2026-03-01", -2)).toBe("2026-02-27");
  });
});

describe("daysBetweenISO", () => {
  it("calcula diferencias positivas y negativas", () => {
    expect(daysBetweenISO("2026-03-10", "2026-03-15")).toBe(5);
    expect(daysBetweenISO("2026-03-15", "2026-03-10")).toBe(-5);
    expect(daysBetweenISO("2026-03-10", "2026-03-10")).toBe(0);
  });

  it("cruza meses correctamente", () => {
    expect(daysBetweenISO("2026-02-27", "2026-03-02")).toBe(3);
  });
});

describe("businessTodayISO", () => {
  it("usa el calendario de Caracas, no el del huso del servidor", () => {
    // 2026-01-15 23:30 en Caracas (UTC-4) = 2026-01-16T03:30:00Z. En UTC ya
    // es 16 de enero, pero para el negocio sigue siendo 15.
    expect(businessTodayISO(new Date("2026-01-16T03:30:00Z"))).toBe("2026-01-15");
    expect(businessTodayISO(new Date("2026-01-15T16:00:00Z"))).toBe("2026-01-15");
  });
});

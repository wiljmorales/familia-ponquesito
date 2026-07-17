import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  caracasMidnightUtc,
  lastCompleteWeekPeriod,
  upcomingCelebrationsWindow,
} from "./period";

describe("lastCompleteWeekPeriod", () => {
  it("el lunes a las 12:00 UTC (8:00 a. m. Caracas) reporta la semana lunes–domingo anterior", () => {
    // 2026-07-13 es lunes.
    const period = lastCompleteWeekPeriod(new Date("2026-07-13T12:00:00Z"));

    expect(period.start).toBe("2026-07-06");
    expect(period.end).toBe("2026-07-12");
    expect(period.timezone).toBe("America/Caracas");
  });

  it("traduce los límites a instantes UTC de medianoche de Caracas (UTC-4)", () => {
    const period = lastCompleteWeekPeriod(new Date("2026-07-13T12:00:00Z"));

    expect(period.startUtc).toBe("2026-07-06T04:00:00.000Z");
    // Exclusivo: la medianoche de Caracas del lunes siguiente.
    expect(period.endExclusiveUtc).toBe("2026-07-13T04:00:00.000Z");
  });

  it("usa el calendario de Caracas, no el del servidor: lunes 02:00 UTC todavía es domingo en Caracas", () => {
    // 2026-07-13T02:00Z = domingo 2026-07-12 22:00 en Caracas: la semana
    // 07-06..07-12 aún no termina allá, así que se reporta la anterior.
    const period = lastCompleteWeekPeriod(new Date("2026-07-13T02:00:00Z"));

    expect(period.start).toBe("2026-06-29");
    expect(period.end).toBe("2026-07-05");
  });

  it("cualquier día de la misma semana produce el mismo periodo (disparo manual un jueves)", () => {
    const monday = lastCompleteWeekPeriod(new Date("2026-07-13T12:00:00Z"));
    const thursday = lastCompleteWeekPeriod(new Date("2026-07-16T20:00:00Z"));

    expect(thursday).toEqual(monday);
  });

  it("un domingo reporta la semana que terminó el domingo anterior (la actual no está completa)", () => {
    // 2026-07-12 es domingo en Caracas a esta hora.
    const period = lastCompleteWeekPeriod(new Date("2026-07-12T15:00:00Z"));

    expect(period.start).toBe("2026-06-29");
    expect(period.end).toBe("2026-07-05");
  });

  it("cruza límites de mes y año sin desfase", () => {
    // 2026-01-01 es jueves; la última semana completa es 2025-12-22..2025-12-28.
    const period = lastCompleteWeekPeriod(new Date("2026-01-01T12:00:00Z"));

    expect(period.start).toBe("2025-12-22");
    expect(period.end).toBe("2025-12-28");
  });
});

describe("addDaysToDateString", () => {
  it("suma y resta días cruzando meses", () => {
    expect(addDaysToDateString("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("caracasMidnightUtc", () => {
  it("la medianoche de Caracas es las 04:00 UTC del mismo día", () => {
    expect(caracasMidnightUtc("2026-07-06")).toBe("2026-07-06T04:00:00.000Z");
  });
});

describe("upcomingCelebrationsWindow", () => {
  it("va de hoy (calendario Caracas) a dentro de 7 días, ambos inclusive", () => {
    const window = upcomingCelebrationsWindow(new Date("2026-07-13T12:00:00Z"));

    expect(window).toEqual({ from: "2026-07-13", to: "2026-07-20" });
  });

  it("respeta el día calendario de Caracas cerca de la medianoche UTC", () => {
    // 02:00 UTC del 13 = 22:00 del 12 en Caracas.
    const window = upcomingCelebrationsWindow(new Date("2026-07-13T02:00:00Z"));

    expect(window).toEqual({ from: "2026-07-12", to: "2026-07-19" });
  });
});

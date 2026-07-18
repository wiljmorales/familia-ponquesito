import { describe, expect, it } from "vitest";
import {
  addMonthsISO,
  buildMonthGrid,
  monthDateRange,
  monthLabelEs,
  monthOfISO,
} from "./calendar";

describe("monthOfISO / addMonthsISO", () => {
  it("extrae el mes de un día", () => {
    expect(monthOfISO("2026-08-15")).toBe("2026-08");
  });

  it("suma meses con desbordes de año", () => {
    expect(addMonthsISO("2026-11", 2)).toBe("2027-01");
    expect(addMonthsISO("2026-01", -1)).toBe("2025-12");
    expect(addMonthsISO("2026-07", 0)).toBe("2026-07");
  });
});

describe("monthDateRange", () => {
  it("devuelve el primer y último día del mes", () => {
    expect(monthDateRange("2026-08")).toEqual({
      startISO: "2026-08-01",
      endISO: "2026-08-31",
    });
  });

  it("maneja febrero y años bisiestos", () => {
    expect(monthDateRange("2026-02").endISO).toBe("2026-02-28");
    expect(monthDateRange("2028-02").endISO).toBe("2028-02-29");
  });
});

describe("monthLabelEs", () => {
  it("formatea el mes en español", () => {
    expect(monthLabelEs("2026-08").toLowerCase()).toContain("agosto");
    expect(monthLabelEs("2026-08")).toContain("2026");
  });
});

describe("buildMonthGrid", () => {
  it("arma semanas completas de 7 celdas que empiezan en lunes", () => {
    // Agosto 2026: el 1.º es sábado → 5 celdas de relleno al inicio.
    const weeks = buildMonthGrid("2026-08");
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0]).toEqual([null, null, null, null, null, "2026-08-01", "2026-08-02"]);
    expect(weeks.at(-1)!.filter(Boolean).at(-1)).toBe("2026-08-31");
  });

  it("incluye todos los días del mes exactamente una vez", () => {
    const days = buildMonthGrid("2026-02").flat().filter(Boolean);
    expect(days).toHaveLength(28);
    expect(days[0]).toBe("2026-02-01");
    expect(new Set(days).size).toBe(28);
  });

  it("un mes que empieza en lunes no lleva relleno inicial", () => {
    // Junio 2026 empieza en lunes.
    const weeks = buildMonthGrid("2026-06");
    expect(weeks[0][0]).toBe("2026-06-01");
  });
});

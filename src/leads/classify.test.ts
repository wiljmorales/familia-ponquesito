import { describe, expect, it } from "vitest";
import { classifyLeadPriority } from "./classify";

// "hoy" fijo para pruebas deterministas: 2026-01-15 mediodía en Caracas
// (UTC-4) = 2026-01-15T16:00:00Z.
const TODAY_NOON_CARACAS = new Date("2026-01-15T16:00:00Z");

function celebrationDaysAhead(days: number): string {
  // Enero tiene 31 días: sumar hasta 11 no cruza de mes, así se evita
  // depender de la misma lógica de suma de días que prueba classify.ts.
  return `2026-01-${String(15 + days).padStart(2, "0")}`;
}

describe("classifyLeadPriority", () => {
  it("clasifica exactamente los límites documentados", () => {
    expect(classifyLeadPriority(celebrationDaysAhead(2), TODAY_NOON_CARACAS)).toBe(
      "not_viable",
    );
    expect(classifyLeadPriority(celebrationDaysAhead(3), TODAY_NOON_CARACAS)).toBe("urgent");
    expect(classifyLeadPriority(celebrationDaysAhead(4), TODAY_NOON_CARACAS)).toBe("urgent");
    expect(classifyLeadPriority(celebrationDaysAhead(5), TODAY_NOON_CARACAS)).toBe("high");
    expect(classifyLeadPriority(celebrationDaysAhead(10), TODAY_NOON_CARACAS)).toBe("high");
    expect(classifyLeadPriority(celebrationDaysAhead(11), TODAY_NOON_CARACAS)).toBe("normal");
  });

  it("clasifica el mismo día y días negativos (fecha pasada) como not_viable", () => {
    expect(classifyLeadPriority(celebrationDaysAhead(0), TODAY_NOON_CARACAS)).toBe(
      "not_viable",
    );
    expect(classifyLeadPriority("2026-01-01", TODAY_NOON_CARACAS)).toBe("not_viable");
  });

  it("usa la fecha calendario de Caracas, no la del huso horario del servidor", () => {
    // 2026-01-15 23:30 en Caracas (UTC-4) = 2026-01-16T03:30:00Z. Si el
    // cálculo usara UTC directamente (o el huso local del proceso, que en
    // Vercel es UTC), "hoy" se leería como 16 de enero — un día adelantado
    // frente al calendario real del negocio — y este caso clasificaría
    // distinto.
    const lateEveningInCaracas = new Date("2026-01-16T03:30:00Z");
    expect(classifyLeadPriority("2026-01-18", lateEveningInCaracas)).toBe("urgent");
  });
});

import { describe, expect, it } from "vitest";
import { buildFallbackDecision, parseAgentDecision } from "./schema";
import type { AgentDecision } from "./types";

/** Decisión válida de referencia; cada prueba muta solo lo que necesita. */
function validDecision(overrides: Partial<AgentDecision> = {}): Record<string, unknown> {
  return {
    intent: "new_order",
    confidence: 0.9,
    reason: "La persona quiere encargar una torta con fecha y cantidad claras.",
    route: "lead_automation",
    urgency: "normal",
    requiresHuman: false,
    detectedOrderCode: null,
    detectedCelebrationDate: "2026-07-25",
    missingFields: [],
    recommendedAction: "Registrar el lead y enviarlo al flujo comercial.",
    ...overrides,
  };
}

function parse(value: Record<string, unknown>): AgentDecision | null {
  return parseAgentDecision(JSON.stringify(value));
}

describe("parseAgentDecision", () => {
  it("acepta una decisión válida", () => {
    const decision = parse(validDecision());
    expect(decision).not.toBeNull();
    expect(decision?.intent).toBe("new_order");
    expect(decision?.route).toBe("lead_automation");
  });

  it("rechaza intenciones desconocidas", () => {
    expect(parse(validDecision({ intent: "spam" as never }))).toBeNull();
  });

  it("rechaza confianza fuera del rango 0–1", () => {
    expect(parse(validDecision({ confidence: 1.2 }))).toBeNull();
    expect(parse(validDecision({ confidence: -0.1 }))).toBeNull();
  });

  it("rechaza una ruta incoherente con la intención", () => {
    expect(
      parse(validDecision({ intent: "general_question", route: "lead_automation" })),
    ).toBeNull();
  });

  it("permite escalar a humano cualquier intención solo si requiresHuman es true", () => {
    expect(
      parse(
        validDecision({ intent: "new_order", route: "human_escalation", requiresHuman: true }),
      ),
    ).not.toBeNull();
    expect(
      parse(
        validDecision({ intent: "new_order", route: "human_escalation", requiresHuman: false }),
      ),
    ).toBeNull();
  });

  it("rechaza un caso sensible sin intervención humana", () => {
    expect(
      parse(
        validDecision({
          intent: "sensitive_or_urgent_case",
          route: "human_escalation",
          requiresHuman: false,
        }),
      ),
    ).toBeNull();
  });

  it("rechaza información insuficiente sin campos faltantes", () => {
    expect(
      parse(
        validDecision({
          intent: "missing_information",
          route: "request_information",
          missingFields: [],
        }),
      ),
    ).toBeNull();
  });

  it("rechaza valores de missingFields fuera de la lista permitida", () => {
    expect(
      parse(
        validDecision({
          intent: "missing_information",
          route: "request_information",
          missingFields: ["telepatia"] as never,
        }),
      ),
    ).toBeNull();
  });

  it("rechaza campos arbitrarios fuera del esquema cerrado", () => {
    expect(parse({ ...validDecision(), sorpresa: true })).toBeNull();
  });

  it("normaliza códigos y fechas inventados a null en vez de rechazar todo", () => {
    const decision = parse(
      validDecision({
        detectedOrderCode: "PEDIDO-MAGICO-99" as never,
        detectedCelebrationDate: "el sábado" as never,
      }),
    );
    expect(decision).not.toBeNull();
    expect(decision?.detectedOrderCode).toBeNull();
    expect(decision?.detectedCelebrationDate).toBeNull();
  });

  it("normaliza el código de pedido a mayúsculas y deduplica missingFields", () => {
    const decision = parse(
      validDecision({
        intent: "missing_information",
        route: "request_information",
        detectedOrderCode: "ped-001" as never,
        missingFields: ["guest_count", "guest_count", "celebration_date"] as never,
      }),
    );
    expect(decision?.detectedOrderCode).toBe("PED-001");
    expect(decision?.missingFields).toEqual(["guest_count", "celebration_date"]);
  });

  it("devuelve null ante JSON inválido, vacío o no-objeto", () => {
    expect(parseAgentDecision(undefined)).toBeNull();
    expect(parseAgentDecision("")).toBeNull();
    expect(parseAgentDecision("no es json")).toBeNull();
    expect(parseAgentDecision('"texto"')).toBeNull();
  });
});

describe("buildFallbackDecision", () => {
  it("produce una decisión segura que siempre pasa a revisión humana", () => {
    const decision = buildFallbackDecision("timeout del proveedor");
    expect(decision.route).toBe("human_escalation");
    expect(decision.requiresHuman).toBe(true);
    expect(decision.confidence).toBe(0);
    expect(decision.reason).toContain("timeout del proveedor");
  });
});

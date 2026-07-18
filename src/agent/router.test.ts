import { describe, expect, it } from "vitest";
import { routeAgentDecision } from "./router";
import { buildFallbackDecision } from "./schema";
import { CANONICAL_ROUTE_BY_INTENT, type AgentDecision, type AgentIntent } from "./types";

function decisionFor(intent: AgentIntent): AgentDecision {
  const route = CANONICAL_ROUTE_BY_INTENT[intent];
  return {
    intent,
    confidence: 0.9,
    reason: "Decisión de prueba.",
    route,
    urgency: "normal",
    requiresHuman: intent === "sensitive_or_urgent_case",
    detectedOrderCode: null,
    detectedCelebrationDate: null,
    missingFields: intent === "missing_information" ? ["celebration_date"] : [],
    recommendedAction: "Acción de prueba.",
  };
}

describe("routeAgentDecision", () => {
  it("lleva cada intención a su ruta canónica (una sola ruta por caso)", () => {
    expect(routeAgentDecision(decisionFor("new_order"))).toBe("lead_automation");
    expect(routeAgentDecision(decisionFor("general_question"))).toBe("knowledge_answer");
    expect(routeAgentDecision(decisionFor("missing_information"))).toBe("request_information");
    expect(routeAgentDecision(decisionFor("order_change_or_cancellation"))).toBe("order_review");
    expect(routeAgentDecision(decisionFor("sensitive_or_urgent_case"))).toBe("human_escalation");
  });

  it("el fallback siempre llega a revisión humana", () => {
    expect(routeAgentDecision(buildFallbackDecision("proveedor caído"))).toBe(
      "human_escalation",
    );
  });

  it("una ruta desconocida degrada a revisión humana en vez de fallar", () => {
    const corrupted = { ...decisionFor("new_order"), route: "teletransporte" as never };
    expect(routeAgentDecision(corrupted)).toBe("human_escalation");
  });
});

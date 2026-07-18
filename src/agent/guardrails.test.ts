import { describe, expect, it } from "vitest";
import { createPrototypeOrders } from "@/data/prototype-orders";
import { addDaysISO } from "@/lib/business-dates";
import {
  applyBusinessGuardrails,
  extractOrderCode,
  extractRelativeDayReference,
  type GuardrailContext,
} from "./guardrails";
import type { AgentDecision } from "./types";

const TODAY = "2026-07-17";

function decision(overrides: Partial<AgentDecision> = {}): AgentDecision {
  return {
    intent: "new_order",
    confidence: 0.9,
    reason: "Quiere encargar una torta.",
    route: "lead_automation",
    urgency: "normal",
    requiresHuman: false,
    detectedOrderCode: null,
    detectedCelebrationDate: null,
    missingFields: [],
    recommendedAction: "Registrar el lead.",
    ...overrides,
  };
}

function context(overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    message: "Quiero una torta para dentro de ocho días, somos 30 personas.",
    todayISO: TODAY,
    orders: createPrototypeOrders(TODAY),
    hasContact: true,
    ...overrides,
  };
}

describe("extractRelativeDayReference", () => {
  it("resuelve referencias relativas contra el calendario del negocio", () => {
    expect(extractRelativeDayReference("dentro de ocho días", TODAY)).toEqual({
      daysUntil: 8,
      dateISO: addDaysISO(TODAY, 8),
    });
    expect(extractRelativeDayReference("en 5 días es la fiesta", TODAY)?.daysUntil).toBe(5);
    expect(extractRelativeDayReference("la celebración es mañana", TODAY)?.daysUntil).toBe(1);
    expect(extractRelativeDayReference("es pasado mañana", TODAY)?.daysUntil).toBe(2);
    expect(extractRelativeDayReference("la necesito para hoy", TODAY)?.daysUntil).toBe(0);
  });

  it('no confunde "por la mañana" ni "pagar hoy" con fechas de celebración', () => {
    expect(extractRelativeDayReference("entrego por la mañana el diseño", TODAY)).toBeNull();
    expect(extractRelativeDayReference("puedo pagar hoy el anticipo", TODAY)).toBeNull();
  });
});

describe("extractOrderCode", () => {
  it("detecta códigos PED y FP sin importar mayúsculas", () => {
    expect(extractOrderCode("soy la persona del pedido ped-001")).toBe("PED-001");
    expect(extractOrderCode("mi solicitud es FP-2-A7K9")).toBe("FP-2-A7K9");
    expect(extractOrderCode("no tengo código")).toBeNull();
  });
});

describe("applyBusinessGuardrails", () => {
  it("un pedido para el mismo día nunca sigue automático: pasa a Karem", () => {
    const result = applyBusinessGuardrails(
      decision(),
      context({ message: "Necesito una torta para hoy mismo, pago lo que sea." }),
    );
    expect(result.decision.route).toBe("human_escalation");
    expect(result.decision.requiresHuman).toBe(true);
    expect(result.decision.urgency).toBe("critical");
    expect(result.corrections.some((c) => c.rule === "anticipacion-minima")).toBe(true);
  });

  it("menos de tres días de anticipación activa revisión y urgencia", () => {
    const result = applyBusinessGuardrails(
      decision({ detectedCelebrationDate: addDaysISO(TODAY, 2) }),
      context({ message: "Quiero una torta para la fiesta." }),
    );
    expect(result.decision.route).toBe("human_escalation");
    expect(result.corrections.some((c) => c.rule === "anticipacion-minima")).toBe(true);
  });

  it("con la anticipación cumplida no interviene ninguna regla", () => {
    const result = applyBusinessGuardrails(
      decision({ detectedCelebrationDate: addDaysISO(TODAY, 8) }),
      context(),
    );
    expect(result.decision.route).toBe("lead_automation");
    expect(result.corrections.filter((c) => c.rule !== "fecha-relativa-determinista")).toEqual(
      [],
    );
  });

  it("una alergia siempre requiere humano, incluso si el modelo la trató como consulta", () => {
    const result = applyBusinessGuardrails(
      decision({
        intent: "general_question",
        route: "knowledge_answer",
        requiresHuman: false,
        urgency: "low",
      }),
      context({
        message: "Un invitado tiene alergia severa, ¿garantizan cero contacto con el alérgeno?",
      }),
    );
    expect(result.decision.route).toBe("human_escalation");
    expect(result.decision.requiresHuman).toBe(true);
    expect(result.corrections.some((c) => c.rule === "seguridad-alimentaria")).toBe(true);
  });

  it("un cambio de pedido para mañana no se acepta automáticamente", () => {
    const result = applyBusinessGuardrails(
      decision({
        intent: "order_change_or_cancellation",
        route: "order_review",
        requiresHuman: false,
        detectedOrderCode: "PED-001",
      }),
      context({
        message: "Soy del pedido PED-001, quiero cambiar el sabor y la celebración es mañana.",
      }),
    );
    expect(result.decision.route).toBe("order_review");
    expect(result.decision.requiresHuman).toBe(true);
    expect(result.decision.urgency).toBe("critical");
    expect(result.corrections.some((c) => c.rule === "cambio-requiere-confirmacion")).toBe(true);
    // PED-001 está registrado a 9 días: la fecha declarada no coincide.
    expect(result.corrections.some((c) => c.rule === "cambio-fecha-discrepante")).toBe(true);
  });

  it("una consulta general jamás termina en la máquina de leads", () => {
    const incoherent = decision({
      intent: "general_question",
      route: "lead_automation",
      requiresHuman: false,
    });
    const result = applyBusinessGuardrails(
      incoherent,
      context({ message: "¿Qué sabores tienen y hacen delivery?" }),
    );
    expect(result.decision.route).toBe("knowledge_answer");
    expect(result.corrections.some((c) => c.rule === "consulta-sin-lead")).toBe(true);
  });

  it("información insuficiente sin lista del modelo devuelve los campos esenciales", () => {
    const result = applyBusinessGuardrails(
      decision({
        intent: "missing_information",
        route: "request_information",
        missingFields: [],
      }),
      context({ message: "Hola, quiero una torta. ¿Cuánto cuesta?", hasContact: false }),
    );
    expect(result.decision.missingFields).toEqual(["celebration_date", "guest_count", "contact"]);
    expect(result.corrections.some((c) => c.rule === "campos-faltantes-minimos")).toBe(true);
  });

  it("sin datos de contacto la máquina de leads no se ejecuta: se piden primero", () => {
    const result = applyBusinessGuardrails(
      decision({ detectedCelebrationDate: addDaysISO(TODAY, 8) }),
      context({ hasContact: false }),
    );
    expect(result.decision.route).toBe("request_information");
    expect(result.decision.missingFields).toContain("contact");
    expect(result.corrections.some((c) => c.rule === "lead-sin-contacto")).toBe(true);
  });

  it("el código citado en el mensaje prevalece: completa omisiones y descarta inventos", () => {
    const missed = applyBusinessGuardrails(
      decision({ intent: "order_change_or_cancellation", route: "order_review" }),
      context({ message: "Quiero cambiar el sabor del pedido PED-003." }),
    );
    expect(missed.decision.detectedOrderCode).toBe("PED-003");

    const invented = applyBusinessGuardrails(
      decision({
        intent: "order_change_or_cancellation",
        route: "order_review",
        detectedOrderCode: "PED-999",
      }),
      context({ message: "Quiero cambiar el sabor de mi pedido." }),
    );
    expect(invented.decision.detectedOrderCode).toBeNull();
  });

  it("una confianza demasiado baja degrada a revisión humana", () => {
    const result = applyBusinessGuardrails(
      decision({ confidence: 0.2, detectedCelebrationDate: addDaysISO(TODAY, 8) }),
      context(),
    );
    expect(result.decision.route).toBe("human_escalation");
    expect(result.corrections.some((c) => c.rule === "confianza-baja")).toBe(true);
  });

  it("no registra corrección de seguridad si la decisión ya era segura", () => {
    const result = applyBusinessGuardrails(
      decision({
        intent: "sensitive_or_urgent_case",
        route: "human_escalation",
        requiresHuman: true,
        urgency: "high",
      }),
      context({ message: "Tengo un reclamo por una alergia." }),
    );
    expect(result.corrections.some((c) => c.rule === "seguridad-alimentaria")).toBe(false);
  });
});

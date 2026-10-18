import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessAgentMessageDeps } from "./service";

// El servicio (y processLead) importan "server-only"; en Vitest no hay
// bundler que distinga cliente/servidor, así que se neutraliza aquí.
vi.mock("server-only", () => ({}));

import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import type { EmailClient } from "@/email/client";
import {
  parseAgentRequest,
  processAgentMessage,
  AgentInputError,
  FREE_MESSAGE_SOURCE_LABEL,
} from "./service";
import { AGENT_DEMO_CASES } from "./demo-cases";
import type { AgentAnalysis, AgentDecision } from "./types";

/**
 * Fake mínimo de Supabase para el flujo completo del agente: cubre los
 * patrones de agent_decisions (insert().select().single() y
 * update().eq()) y los que processLead (Reto 4, REAL en estas pruebas)
 * usa sobre leads y lead_automation_events.
 */
interface FakeRow {
  [key: string]: unknown;
}

class FakeTable {
  rows: FakeRow[] = [];
  private nextId = 1;

  constructor(
    private readonly uniqueConstraints: { name: string; columns: string[] }[] = [],
  ) {}

  insert(row: Record<string, unknown>) {
    for (const constraint of this.uniqueConstraints) {
      const clashes = this.rows.some((existing) =>
        constraint.columns.every((col) => existing[col] === row[col]),
      );
      if (clashes) {
        return {
          data: null,
          error: {
            code: "23505",
            message: `duplicate key value violates unique constraint "${constraint.name}"`,
          },
        };
      }
    }
    const stored: FakeRow = { id: `row-${this.nextId++}`, ...row };
    this.rows.push(stored);
    return { data: stored, error: null };
  }
}

function createFakeSupabase() {
  const tables: Record<string, FakeTable> = {
    agent_decisions: new FakeTable(),
    leads: new FakeTable([
      { name: "leads_source_unique", columns: ["source_type", "source_id"] },
      { name: "leads_reference_code_key", columns: ["reference_code"] },
    ]),
    lead_automation_events: new FakeTable(),
  };
  const post = (async (operation: string, payload: Record<string, unknown> | FormData) => {
    const p = payload as Record<string, unknown>;
    if (operation === "agent-create") {
      const inserted = tables.agent_decisions.insert(p);
      return { ok: true, id: inserted.data?.id };
    }
    if (operation === "agent-update") {
      const row = tables.agent_decisions.rows.find(item => item.id === p.id);
      if (row) Object.assign(row, { status: p.status, executed_action: p.executed_action });
      return { ok: Boolean(row) };
    }
    if (operation === "lead-by-source") {
      return { ok: true, lead: tables.leads.rows.find(row => row.source_type === p.source_type && row.source_id === p.source_id) ?? null };
    }
    if (operation === "lead-ensure") {
      const existing = tables.leads.rows.find(row => row.source_type === p.source_type && row.source_id === p.source_id);
      if (existing) return { ok: true, ...existing };
      const inserted = tables.leads.insert(p);
      if (inserted.error) return { ok: false, error: "code_taken" };
      tables.lead_automation_events.insert({ lead_id: inserted.data?.id, event_type: "lead_registered", status: "success" });
      return { ok: true, ...inserted.data };
    }
    if (operation === "lead-success") {
      return { ok: true, exists: tables.lead_automation_events.rows.some(row => row.lead_id === p.lead_id && row.event_type === p.event_type && row.status === "success") };
    }
    if (operation === "lead-event") {
      tables.lead_automation_events.insert(p);
      return { ok: true };
    }
    if (operation === "email-claim") {
      const alreadySent = tables.lead_automation_events.rows.some(row => row.lead_id === p.lead_id && row.event_type === p.event_type && row.status === "success");
      return alreadySent ? { ok: true, state: "sent" } : { ok: true, state: "claimed", claim: `${p.lead_id}:${p.event_type}` };
    }
    if (operation === "email-finish") {
      tables.lead_automation_events.insert({ lead_id: p.lead_id, event_type: p.event_type, status: p.success ? "success" : "error" });
      return { ok: true };
    }
    throw new Error(`Unexpected test operation: ${operation}`);
  }) as NonNullable<ProcessAgentMessageDeps["post"]>;
  return { post, tables };
}

function createFakeEmailClient(): { client: EmailClient; sent: Array<{ to: string; subject: string }> } {
  const sent: Array<{ to: string; subject: string }> = [];
  return {
    sent,
    client: {
      async send(message) {
        sent.push({ to: message.to, subject: message.subject });
        return { ok: true, providerId: `fake-${sent.length}` };
      },
    },
  };
}

const TODAY = businessTodayISO();

function geminiAnalysis(decision: Partial<AgentDecision>): AgentAnalysis {
  return {
    source: "gemini",
    decision: {
      intent: "new_order",
      confidence: 0.9,
      reason: "Decisión simulada del modelo para la prueba.",
      route: "lead_automation",
      urgency: "normal",
      requiresHuman: false,
      detectedOrderCode: null,
      detectedCelebrationDate: null,
      missingFields: [],
      recommendedAction: "Acción simulada.",
      ...decision,
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseAgentRequest", () => {
  it("usa siempre el mensaje canónico del caso demo (el cliente solo manda el id)", () => {
    vi.stubEnv("AGENT_DEMO_CUSTOMER_EMAIL", "demo@correo-de-prueba.dev");
    const input = parseAgentRequest({ demoCaseId: "caso-1", message: "otro texto" });
    expect(input.message).toBe(AGENT_DEMO_CASES[0].message);
    expect(input.sourceLabel).toBe(AGENT_DEMO_CASES[0].sourceLabel);
    expect(input.contact?.email).toBe("demo@correo-de-prueba.dev");
  });

  it("rechaza casos demo inexistentes y mensajes vacíos o excesivos", () => {
    expect(() => parseAgentRequest({ demoCaseId: "caso-99" })).toThrow(AgentInputError);
    expect(() => parseAgentRequest({ message: "   " })).toThrow(AgentInputError);
    expect(() => parseAgentRequest({ message: "x".repeat(1001) })).toThrow(AgentInputError);
    expect(() => parseAgentRequest("texto")).toThrow(AgentInputError);
  });

  it("un mensaje libre queda sin contacto y con la fuente de demostración", () => {
    const input = parseAgentRequest({ message: "Hola, ¿qué sabores tienen?" });
    expect(input.sourceLabel).toBe(FREE_MESSAGE_SOURCE_LABEL);
    expect(input.contact).toBeNull();
    expect(input.demoCaseId).toBeNull();
  });
});

describe("processAgentMessage — integración mensaje → decisión → guardrails → ruta → resultado", () => {
  it("caso 1: registra el lead de verdad con processLead() del Reto 4", async () => {
    vi.stubEnv("AGENT_DEMO_CUSTOMER_EMAIL", "demo@correo-de-prueba.dev");
    const { post, tables } = createFakeSupabase();
    const email = createFakeEmailClient();

    const result = await processAgentMessage(
      { demoCaseId: "caso-1" },
      {
        analyzer: async () =>
          geminiAnalysis({
            intent: "new_order",
            route: "lead_automation",
            detectedCelebrationDate: addDaysISO(TODAY, 8),
          }),
        post,
        emailClient: email.client,
        karemEmail: "karem@correo-de-prueba.dev",
      },
    );

    expect(result.decision.intent).toBe("new_order");
    expect(result.route).toBe("lead_automation");
    expect(result.execution.status).toBe("lead_registered");
    expect(result.persisted).toBe(true);

    // El lead existe de verdad, clasificado por el Reto 4 (8 días → high),
    // con la fila de agent_decisions como origen.
    const lead = tables.leads.rows[0];
    expect(lead.source_type).toBe("agent_message");
    expect(lead.source_id).toBe(tables.agent_decisions.rows[0].id);
    expect(lead.priority).toBe("high");
    expect(String(lead.reference_code)).toMatch(/^FP-7-/);

    // La automatización del Reto 4 envió ambos correos.
    expect(email.sent.map((m) => m.to).sort()).toEqual([
      "demo@correo-de-prueba.dev",
      "karem@correo-de-prueba.dev",
    ]);

    // La fila de la decisión quedó completada, no en processing.
    expect(tables.agent_decisions.rows[0].status).toBe("lead_registered");
    expect(tables.agent_decisions.rows[0].executed_action).toContain("FP-7-");
  });

  it("caso 2: responde con la base de conocimiento y no crea ningún lead", async () => {
    const { post, tables } = createFakeSupabase();

    const result = await processAgentMessage(
      { demoCaseId: "caso-2" },
      {
        analyzer: async () =>
          geminiAnalysis({
            intent: "general_question",
            route: "knowledge_answer",
            urgency: "low",
          }),
        post,
        askKnowledge: async () => ({
          status: "answered",
          reply: "Tenemos vainilla, chocolate, red velvet y tres leches.",
        }),
      },
    );

    expect(result.decision.intent).toBe("general_question");
    expect(result.route).toBe("knowledge_answer");
    expect(result.execution.status).toBe("answered");
    expect(result.execution.details[0]).toContain("vainilla");
    expect(tables.leads.rows).toHaveLength(0);
  });

  it("caso 3: pide solo los datos faltantes y queda esperando información", async () => {
    const { post, tables } = createFakeSupabase();

    const result = await processAgentMessage(
      { demoCaseId: "caso-3" },
      {
        analyzer: async () =>
          geminiAnalysis({
            intent: "missing_information",
            route: "request_information",
            missingFields: ["celebration_date", "guest_count"],
          }),
        post,
      },
    );

    expect(result.route).toBe("request_information");
    expect(result.execution.status).toBe("waiting_information");
    expect(result.execution.details[0]).toContain("fecha de la celebración");
    expect(result.execution.details[0]).not.toMatch(/\$|precio de|cuesta \d/);
    expect(tables.leads.rows).toHaveLength(0);
  });

  it("caso 4: identifica PED-001, aplica la política y escala sin confirmar el cambio", async () => {
    const { post } = createFakeSupabase();

    const result = await processAgentMessage(
      { demoCaseId: "caso-4" },
      {
        analyzer: async () =>
          geminiAnalysis({
            intent: "order_change_or_cancellation",
            route: "order_review",
            detectedOrderCode: "PED-001",
            urgency: "high",
          }),
        post,
      },
    );

    expect(result.route).toBe("order_review");
    expect(result.decision.detectedOrderCode).toBe("PED-001");
    expect(result.decision.requiresHuman).toBe(true);
    expect(result.decision.urgency).toBe("critical");
    expect(result.execution.status).toBe("escalated_to_human");
    expect(result.execution.executedAction).toContain("no se confirma automáticamente");
    // La regla determinista intervino (fecha declarada vs. registrada).
    expect(result.guardrailCorrections.length).toBeGreaterThan(0);
    expect(result.timeline.some((step) => step.includes("PED-001"))).toBe(true);
  });

  it("caso 5: detiene la respuesta automática y escala a revisión humana", async () => {
    const { post } = createFakeSupabase();

    const result = await processAgentMessage(
      { demoCaseId: "caso-5" },
      {
        analyzer: async () =>
          geminiAnalysis({
            intent: "sensitive_or_urgent_case",
            route: "human_escalation",
            requiresHuman: true,
            urgency: "high",
          }),
        post,
      },
    );

    expect(result.route).toBe("human_escalation");
    expect(result.execution.status).toBe("escalated_to_human");
    expect(result.execution.executedAction).toContain("Respuesta automática detenida");
    expect(result.execution.executedAction).not.toMatch(/garantiza/i);
  });

  it("si la IA falla, el mensaje no se pierde: fallback registrado y revisión humana", async () => {
    const { post, tables } = createFakeSupabase();

    const result = await processAgentMessage(
      { message: "Mensaje que el modelo no pudo interpretar." },
      {
        analyzer: async () => {
          throw new Error("proveedor caído");
        },
        post,
      },
    );

    expect(result.decisionSource).toBe("fallback");
    expect(result.route).toBe("human_escalation");
    expect(result.execution.status).toBe("escalated_to_human");
    expect(result.persisted).toBe(true);
    expect(tables.agent_decisions.rows[0].decision_source).toBe("fallback");
    expect(tables.leads.rows).toHaveLength(0);
  });

  it("la regla del negocio corrige a la IA: alergia tratada como consulta termina en humano", async () => {
    const { post } = createFakeSupabase();

    const result = await processAgentMessage(
      { message: "Mi hijo tiene alergia al maní, ¿la torta es segura?" },
      {
        analyzer: async () =>
          geminiAnalysis({
            intent: "general_question",
            route: "knowledge_answer",
            urgency: "low",
          }),
        post,
      },
    );

    expect(result.route).toBe("human_escalation");
    expect(
      result.guardrailCorrections.some((c) => c.rule === "seguridad-alimentaria"),
    ).toBe(true);
    expect(result.timeline.some((step) => step.startsWith("Política del negocio"))).toBe(true);
  });

  it("sin Supabase la demo sigue funcionando y lo dice honestamente", async () => {
    const result = await processAgentMessage(
      { demoCaseId: "caso-2" },
      {
        analyzer: async () =>
          geminiAnalysis({ intent: "general_question", route: "knowledge_answer" }),
        post: null,
        askKnowledge: async () => ({ status: "answered", reply: "Respuesta de prueba." }),
      },
    );

    expect(result.persisted).toBe(false);
    expect(result.execution.status).toBe("answered");
  });
});

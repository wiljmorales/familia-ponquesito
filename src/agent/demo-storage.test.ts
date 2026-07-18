import { describe, expect, it } from "vitest";
import {
  AGENT_DEMO_STORAGE_KEY,
  clearAgentResults,
  loadAgentResults,
  saveAgentResults,
  type StorageLike,
} from "./demo-storage";
import type { AgentCaseResult } from "./types";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function sampleResult(): AgentCaseResult {
  return {
    input: {
      message: "Hola, quiero una torta.",
      sourceLabel: "WhatsApp (simulado)",
      demoCaseId: "caso-3",
      contact: null,
    },
    decision: {
      intent: "missing_information",
      confidence: 0.8,
      reason: "Falta información esencial.",
      route: "request_information",
      urgency: "normal",
      requiresHuman: false,
      detectedOrderCode: null,
      detectedCelebrationDate: null,
      missingFields: ["celebration_date"],
      recommendedAction: "Pedir los datos faltantes.",
    },
    decisionSource: "gemini",
    fallbackReason: null,
    guardrailCorrections: [],
    route: "request_information",
    execution: {
      status: "waiting_information",
      executedAction: "Se preparó la solicitud de datos.",
      details: [],
    },
    timeline: ["Mensaje recibido — WhatsApp (simulado)"],
    persisted: true,
  };
}

describe("demo-storage", () => {
  it("guarda y recupera los resultados de la demo", () => {
    const storage = createMemoryStorage();
    saveAgentResults(storage, [sampleResult()]);
    const loaded = loadAgentResults(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].decision.intent).toBe("missing_information");
  });

  it("con lista vacía limpia la clave", () => {
    const storage = createMemoryStorage();
    saveAgentResults(storage, [sampleResult()]);
    saveAgentResults(storage, []);
    expect(storage.data[AGENT_DEMO_STORAGE_KEY]).toBeUndefined();
  });

  it("ignora JSON corrupto, versiones desconocidas e items irreconocibles", () => {
    expect(
      loadAgentResults(createMemoryStorage({ [AGENT_DEMO_STORAGE_KEY]: "{corrupto" })),
    ).toBeNull();
    expect(
      loadAgentResults(
        createMemoryStorage({
          [AGENT_DEMO_STORAGE_KEY]: JSON.stringify({ version: 99, results: [] }),
        }),
      ),
    ).toBeNull();
    expect(
      loadAgentResults(
        createMemoryStorage({
          [AGENT_DEMO_STORAGE_KEY]: JSON.stringify({
            version: 1,
            results: [{ cualquier: "cosa" }],
          }),
        }),
      ),
    ).toBeNull();
  });

  it("nunca lanza ante un storage que falla (modo privado, cuota)", () => {
    const throwingStorage: StorageLike = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cuota");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(loadAgentResults(throwingStorage)).toBeNull();
    expect(() => saveAgentResults(throwingStorage, [sampleResult()])).not.toThrow();
    expect(() => clearAgentResults(throwingStorage)).not.toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";

/* SDK mockeado: estas pruebas jamás llaman a Gemini ni consumen cuota.
   Cubren la validación de la salida (viene de un servicio externo: no se
   confía en TypeScript) y el mapeo de errores del proveedor. */

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => {
  class ApiError extends Error {
    status: number;
    constructor(options: { message?: string; status: number }) {
      super(options.message ?? "api error");
      this.status = options.status;
    }
  }
  class GoogleGenAI {
    models = { generateContent: mocks.generateContent };
  }
  const Type = { OBJECT: "OBJECT", STRING: "STRING" };
  return { ApiError, GoogleGenAI, Type };
});

import { ApiError } from "@google/genai";
import {
  AssistantProviderError,
  geminiProvider,
  isGeminiConfigured,
  parseModelOutput,
} from "./gemini";

describe("isGeminiConfigured", () => {
  it("detecta la ausencia de GEMINI_API_KEY", () => {
    delete process.env.GEMINI_API_KEY;
    expect(isGeminiConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = "clave-de-prueba";
    expect(isGeminiConfigured()).toBe(true);
    delete process.env.GEMINI_API_KEY;
  });
});

describe("parseModelOutput — validación de la salida externa", () => {
  it("acepta una salida válida", () => {
    const parsed = parseModelOutput(
      JSON.stringify({ status: "answered", message: "Hola 👋" }),
    );
    expect(parsed).toEqual({ status: "answered", reply: "Hola 👋" });
  });

  it("rechaza JSON malformado", () => {
    expect(parseModelOutput("no es json {")).toBeNull();
  });

  it("rechaza salida vacía o ausente", () => {
    expect(parseModelOutput(undefined)).toBeNull();
    expect(parseModelOutput("")).toBeNull();
    expect(parseModelOutput("   ")).toBeNull();
  });

  it("rechaza un status fuera del enum", () => {
    expect(
      parseModelOutput(
        JSON.stringify({ status: "maybe", message: "quizás" }),
      ),
    ).toBeNull();
  });

  it("rechaza un message vacío o no textual", () => {
    expect(
      parseModelOutput(JSON.stringify({ status: "answered", message: "" })),
    ).toBeNull();
    expect(
      parseModelOutput(JSON.stringify({ status: "answered", message: 5 })),
    ).toBeNull();
  });

  it("rechaza estructuras que no son objeto", () => {
    expect(parseModelOutput(JSON.stringify(["answered"]))).toBeNull();
    expect(parseModelOutput(JSON.stringify("answered"))).toBeNull();
  });
});

describe("geminiProvider — fallbacks y errores", () => {
  it("devuelve el fallback seguro ante salida inválida del modelo", async () => {
    mocks.generateContent.mockResolvedValueOnce({ text: "esto no es JSON" });
    const result = await geminiProvider({ message: "hola" });
    expect(result.status).toBe("unknown");
    /* Nunca JSON crudo ni detalles técnicos al usuario. */
    expect(result.reply).not.toContain("{");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("mapea el error 429 a un error de cuota", async () => {
    mocks.generateContent.mockRejectedValueOnce(
      new ApiError({ status: 429, message: "quota exceeded" }),
    );
    await expect(geminiProvider({ message: "hola" })).rejects.toMatchObject({
      kind: "quota",
    });
  });

  it("mapea errores 500/503 a proveedor no disponible", async () => {
    mocks.generateContent.mockRejectedValueOnce(
      new ApiError({ status: 503, message: "unavailable" }),
    );
    await expect(geminiProvider({ message: "hola" })).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("mapea timeouts", async () => {
    mocks.generateContent.mockRejectedValueOnce(
      new Error("Request timed out"),
    );
    await expect(geminiProvider({ message: "hola" })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("mapea errores de red genéricos", async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error("fetch failed"));
    const rejection = expect(geminiProvider({ message: "hola" })).rejects;
    await rejection.toBeInstanceOf(AssistantProviderError);
    mocks.generateContent.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(geminiProvider({ message: "hola" })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("envía el historial y el mensaje en el orden correcto", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ status: "answered", message: "ok" }),
    });
    await geminiProvider({
      message: "¿y de chocolate?",
      history: [
        { role: "user", text: "¿qué sabores hay?" },
        { role: "assistant", text: "Vainilla, chocolate..." },
      ],
    });

    const call = mocks.generateContent.mock.calls.at(-1)?.[0];
    expect(call.contents).toEqual([
      { role: "user", parts: [{ text: "¿qué sabores hay?" }] },
      { role: "model", parts: [{ text: "Vainilla, chocolate..." }] },
      { role: "user", parts: [{ text: "¿y de chocolate?" }] },
    ]);
    /* El prompt del sistema incluye la base de conocimiento real. */
    expect(call.config.systemInstruction).toContain("Familia Ponquesito");
    expect(call.config.systemInstruction).toContain("BASE DE CONOCIMIENTO");
  });
});

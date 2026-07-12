import { describe, expect, it } from "vitest";
import {
  AssistantInputError,
  MAX_MESSAGE_LENGTH,
  askAssistant,
} from "./service";

/* Datos comerciales que el proveedor temporal jamás debe afirmar.
   Si alguna respuesta los menciona, está inventando información. */
const FORBIDDEN_CLAIMS = [/\$\s?\d/, /\d\s?(usd|bs|cop|pesos|bolívares)/i];

async function ask(message: string) {
  return askAssistant({ message });
}

describe("askAssistant — validación de entrada", () => {
  it("rechaza un cuerpo que no es objeto", async () => {
    await expect(askAssistant("hola")).rejects.toThrow(AssistantInputError);
    await expect(askAssistant(null)).rejects.toThrow(AssistantInputError);
  });

  it("rechaza un mensaje ausente o no textual", async () => {
    await expect(askAssistant({})).rejects.toThrow(AssistantInputError);
    await expect(askAssistant({ message: 42 })).rejects.toThrow(
      AssistantInputError,
    );
  });

  it("rechaza un mensaje vacío o solo espacios", async () => {
    await expect(ask("   ")).rejects.toThrow(AssistantInputError);
  });

  it("rechaza un mensaje que supera el largo máximo", async () => {
    await expect(ask("a".repeat(MAX_MESSAGE_LENGTH + 1))).rejects.toThrow(
      AssistantInputError,
    );
  });
});

describe("askAssistant — contrato de respuesta", () => {
  it("siempre devuelve un estado válido y un texto no vacío", async () => {
    const samples = [
      "hola",
      "¿cuánto cuesta un ponqué?",
      "quiero hacer un pedido",
      "xyzzy plugh",
    ];
    for (const message of samples) {
      const result = await ask(message);
      expect(["answered", "unknown", "human_required"]).toContain(
        result.status,
      );
      expect(result.reply.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("askAssistant — comportamiento seguro (no inventar)", () => {
  const businessQuestions = [
    "¿Cuánto cuesta un ponqué?",
    "¿Qué sabores tienen?",
    "¿Cuál es el horario de atención?",
    "¿Hacen delivery en mi zona?",
    "¿Aceptan pago con tarjeta?",
    "¿Cuál es la política de cancelación?",
    "¿Qué productos venden?",
  ];

  it.each(businessQuestions)(
    'responde "unknown" ante datos del negocio: %s',
    async (question) => {
      const result = await ask(question);
      expect(result.status).toBe("unknown");
    },
  );

  it("admite explícitamente que no sabe, sin afirmar datos comerciales", async () => {
    for (const question of businessQuestions) {
      const result = await ask(question);
      expect(result.reply.toLowerCase()).toContain("no lo sé");
      for (const forbidden of FORBIDDEN_CLAIMS) {
        expect(result.reply).not.toMatch(forbidden);
      }
    }
  });

  it('responde "unknown" ante mensajes que no entiende', async () => {
    const result = await ask("xyzzy plugh");
    expect(result.status).toBe("unknown");
  });
});

describe("askAssistant — derivación a una persona", () => {
  it.each([
    "Quiero hacer un pedido",
    "¿Cómo puedo contactarlos?",
    "Necesito hablar con una persona",
    "Quiero encargar algo para el sábado",
  ])('responde "human_required": %s', async (message) => {
    const result = await ask(message);
    expect(result.status).toBe("human_required");
  });
});

describe("askAssistant — lo único que sí responde", () => {
  it.each(["Hola", "¿Qué puedes hacer?", "¿Quién eres?"])(
    'responde "answered" sobre sí mismo: %s',
    async (message) => {
      const result = await ask(message);
      expect(result.status).toBe("answered");
    },
  );

  it("aclara que la base de conocimiento está en construcción", async () => {
    const result = await ask("¿Qué puedes hacer?");
    expect(result.reply.toLowerCase()).toContain("en construcción");
  });
});

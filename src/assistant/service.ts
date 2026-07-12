import { geminiProvider, isGeminiConfigured } from "@/providers/gemini";
import { temporaryProvider } from "./temporary-provider";
import type {
  AssistantProvider,
  AssistantReply,
  AssistantRequest,
  ChatTurn,
} from "./types";

/** Entrada inválida del cliente; el endpoint la traduce a un 400. */
export class AssistantInputError extends Error {}

export const MAX_MESSAGE_LENGTH = 1000;
/** Turnos de contexto que se conservan; el resto se descarta (cuota). */
export const MAX_HISTORY_TURNS = 6;

/**
 * Con GEMINI_API_KEY se usa el proveedor real. Sin ella, el determinista
 * SOLO en desarrollo y pruebas; en producción es un error de configuración
 * y debe fallar de forma visible, nunca degradar en silencio a la demo.
 * Las pruebas también pueden inyectar un proveedor explícito en askAssistant.
 */
export function defaultProvider(): AssistantProvider {
  if (isGeminiConfigured()) {
    return geminiProvider;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Falta GEMINI_API_KEY: el asistente no puede funcionar en producción sin IA.",
    );
  }

  return temporaryProvider;
}

function parseHistory(value: unknown): ChatTurn[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AssistantInputError('El campo "history" debe ser una lista.');
  }

  const turns = value.map((item): ChatTurn => {
    if (typeof item !== "object" || item === null) {
      throw new AssistantInputError("Cada turno del historial debe ser un objeto.");
    }
    const { role, text } = item as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") {
      throw new AssistantInputError(
        'Cada turno del historial necesita un "role" válido.',
      );
    }
    if (
      typeof text !== "string" ||
      text.trim().length === 0 ||
      text.length > MAX_MESSAGE_LENGTH
    ) {
      throw new AssistantInputError(
        'Cada turno del historial necesita un "text" no vacío y acotado.',
      );
    }
    return { role, text: text.trim() };
  });

  return turns.slice(-MAX_HISTORY_TURNS);
}

function parseRequest(input: unknown): AssistantRequest {
  if (typeof input !== "object" || input === null) {
    throw new AssistantInputError("El cuerpo debe ser un objeto JSON.");
  }

  const { message, history } = input as Record<string, unknown>;

  if (typeof message !== "string") {
    throw new AssistantInputError('Falta el campo "message" (texto).');
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    throw new AssistantInputError("El mensaje no puede estar vacío.");
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new AssistantInputError(
      `El mensaje supera el máximo de ${MAX_MESSAGE_LENGTH} caracteres.`,
    );
  }

  return { message: trimmed, history: parseHistory(history) };
}

export async function askAssistant(
  input: unknown,
  provider?: AssistantProvider,
): Promise<AssistantReply> {
  const request = parseRequest(input);
  return (provider ?? defaultProvider())(request);
}

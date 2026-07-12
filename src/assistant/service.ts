import { temporaryProvider } from "./temporary-provider";
import type { AssistantReply, AssistantRequest } from "./types";

/** Entrada inválida del cliente; el endpoint la traduce a un 400. */
export class AssistantInputError extends Error {}

export const MAX_MESSAGE_LENGTH = 1000;

function parseRequest(input: unknown): AssistantRequest {
  if (typeof input !== "object" || input === null) {
    throw new AssistantInputError("El cuerpo debe ser un objeto JSON.");
  }

  const { message } = input as Record<string, unknown>;

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

  return { message: trimmed };
}

export async function askAssistant(input: unknown): Promise<AssistantReply> {
  const { message } = parseRequest(input);
  return temporaryProvider(message);
}

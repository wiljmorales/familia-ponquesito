import { ApiError, GoogleGenAI, Type } from "@google/genai";
import { getKnowledgeBase } from "@/assistant/knowledge";
import { buildSystemPrompt } from "@/assistant/prompt";
import type {
  AssistantProvider,
  AssistantReply,
  AssistantRequest,
  AssistantStatus,
} from "@/assistant/types";

/**
 * Proveedor real: Google Gemini (solo servidor).
 * La API key vive en GEMINI_API_KEY y jamás se registra ni se envía al
 * cliente. La salida del modelo se valida siempre en servidor: viene de un
 * servicio externo, así que TypeScript no garantiza nada.
 */

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPLY_LENGTH = 1200;

/** Fallo del servicio externo; el endpoint lo traduce a un mensaje amable. */
export class AssistantProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "quota" | "unavailable" | "timeout" | "network",
  ) {
    super(message);
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: ["answered", "unknown", "human_required"],
    },
    message: { type: Type.STRING },
  },
  required: ["status", "message"],
  propertyOrdering: ["status", "message"],
};

/** Respuesta segura cuando la salida del modelo no puede validarse. */
const FALLBACK_REPLY: AssistantReply = {
  status: "unknown",
  reply:
    "Disculpa, no pude preparar una respuesta confiable en este momento. " +
    "Prefiero no darte información que no pueda respaldar. ¿Puedes " +
    "intentarlo de nuevo o preguntarme de otra forma?",
};

const VALID_STATUSES: AssistantStatus[] = [
  "answered",
  "unknown",
  "human_required",
];

/**
 * Valida la salida cruda del modelo. Devuelve null si no cumple el
 * contrato; quien llama decide el fallback. Nunca se muestra JSON crudo
 * al usuario.
 */
export function parseModelOutput(raw: string | undefined): AssistantReply | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) {
    return null;
  }

  const { status, message } = data as Record<string, unknown>;

  if (
    typeof status !== "string" ||
    !VALID_STATUSES.includes(status as AssistantStatus)
  ) {
    return null;
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    return null;
  }

  return {
    status: status as AssistantStatus,
    reply: message.trim().slice(0, MAX_REPLY_LENGTH),
  };
}

function toProviderError(error: unknown): AssistantProviderError {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return new AssistantProviderError(
        "Cuota del proveedor agotada",
        "quota",
      );
    }
    return new AssistantProviderError(
      `Proveedor no disponible (HTTP ${error.status})`,
      "unavailable",
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|aborted/i.test(message)) {
    return new AssistantProviderError("Tiempo de espera agotado", "timeout");
  }
  return new AssistantProviderError("Error de red con el proveedor", "network");
}

function buildContents(request: AssistantRequest) {
  const turns = (request.history ?? []).map((turn) => ({
    role: turn.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: turn.text }],
  }));
  return [...turns, { role: "user" as const, parts: [{ text: request.message }] }];
}

export const geminiProvider: AssistantProvider = async (
  request: AssistantRequest,
): Promise<AssistantReply> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let raw: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
      contents: buildContents(request),
      config: {
        systemInstruction: buildSystemPrompt(getKnowledgeBase()),
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 500,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      },
    });
    raw = response.text;
  } catch (error) {
    throw toProviderError(error);
  }

  return parseModelOutput(raw) ?? FALLBACK_REPLY;
};

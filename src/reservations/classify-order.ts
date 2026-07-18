import {
  COMPLEX_CAKE_POINTS,
  CUSTOM_CAKE_POINTS,
  LARGE_ORDER_GUEST_THRESHOLD,
  SIMPLE_CAKE_POINTS,
  type CapacityPoints,
} from "./capacity";

/**
 * Clasificación determinística del pedido (Paso 1 del flujo). Decide
 * cuántos puntos de capacidad consume una torta a partir de las respuestas
 * cerradas del cliente — nunca depende de Gemini ni de ningún modelo: la
 * disponibilidad de una fecha no puede quedar en manos de una IA.
 *
 * Contrato análogo al del asistente (answered | unknown | human_required,
 * Reto 1): aquí el resultado es "classified" (equivale a answered) o
 * "human_required" cuando las señales del texto libre contradicen o
 * exceden lo que las preguntas cerradas capturaron.
 */

export interface OrderClassificationInput {
  guestCount: number;
  /** Respuesta cerrada: ¿la torta tendrá varios pisos? */
  tiers: "one" | "two_or_more";
  /** Respuesta cerrada: ¿decoración personalizada o temática? */
  isCustomDesign: boolean;
  /** ¿El cliente tiene una referencia visual del diseño? */
  hasReferenceImage: boolean;
  /** Descripción breve y libre del diseño. */
  designDescription: string;
}

export type OrderComplexity = "simple" | "custom" | "complex";

export type OrderClassification =
  | {
      kind: "classified";
      complexity: OrderComplexity;
      points: CapacityPoints;
      /** Motivos legibles (para order_details y el correo interno). */
      reasons: string[];
    }
  | {
      kind: "human_required";
      reasons: string[];
      /**
       * Estimación conservadora (el máximo) usada SOLO como referencia
       * interna: una solicitud en revisión humana no consume capacidad.
       */
      estimatedPoints: CapacityPoints;
    };

/**
 * Señales en el texto libre de que el diseño excede lo que las preguntas
 * cerradas capturaron. Deterministas a propósito (regex, no IA). Solo
 * disparan revisión humana cuando contradicen la respuesta cerrada de
 * pisos: si el cliente ya declaró varios pisos, el pedido ya pesa el
 * máximo y no hay nada que revisar.
 */
const STRUCTURAL_SIGNAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /\b(?:varios|dos|tres|cuatro|[2-9])\s+(?:pisos|niveles)\b/i,
    label: "La descripción menciona varios pisos, pero se indicó un solo piso.",
  },
  {
    pattern: /\b(?:estructura\w*|antigravedad|gravedad|esculpid\w+|colgante\w*|flotante\w*|fuente\w*|mecanismo\w*|luces|movimiento)\b/i,
    label: "La descripción menciona elementos estructurales o decoración avanzada.",
  },
];

/**
 * Comportamiento de human_required en el wizard (decisión del checkpoint
 * previo a la Etapa 3): el cliente SÍ ve el calendario y elige su fecha
 * preferida, pero la disponibilidad se consulta de forma provisional con
 * la carga máxima modelada (3 puntos) y solo se recomiendan fechas que
 * podrían soportarla. Al enviar, la solicitud nace en estado
 * human_review, NO consume capacidad y la interfaz nunca presenta la
 * fecha como apartada (prohibido "último cupo" / "fecha reservada"; el
 * mensaje al cliente es HUMAN_REVIEW_DATE_NOTICE).
 */
export const HUMAN_REVIEW_PROVISIONAL_POINTS = COMPLEX_CAKE_POINTS;

/** Mensaje principal que ve el cliente cuando su diseño requiere revisión. */
export const HUMAN_REVIEW_DATE_NOTICE =
  "Tu diseño necesita una revisión personalizada. Puedes indicarnos la fecha " +
  "que prefieres, pero todavía no quedará reservada. Familia Ponquesito " +
  "revisará el pedido y se comunicará contigo para confirmar disponibilidad.";

export function classifyOrder(input: OrderClassificationInput): OrderClassification {
  if (input.tiers === "two_or_more") {
    return {
      kind: "classified",
      complexity: "complex",
      points: COMPLEX_CAKE_POINTS,
      reasons: ["Torta de varios pisos."],
    };
  }

  const structuralSignals = STRUCTURAL_SIGNAL_PATTERNS.filter(({ pattern }) =>
    pattern.test(input.designDescription),
  );

  if (structuralSignals.length > 0) {
    return {
      kind: "human_required",
      reasons: structuralSignals.map(({ label }) => label),
      estimatedPoints: HUMAN_REVIEW_PROVISIONAL_POINTS,
    };
  }

  const customReasons: string[] = [];
  if (input.isCustomDesign) customReasons.push("Decoración personalizada o temática.");
  if (input.hasReferenceImage) customReasons.push("Trae una referencia visual del diseño.");
  if (input.guestCount >= LARGE_ORDER_GUEST_THRESHOLD) {
    customReasons.push(`Pedido grande (${input.guestCount} personas).`);
  }

  if (customReasons.length > 0) {
    return {
      kind: "classified",
      complexity: "custom",
      points: CUSTOM_CAKE_POINTS,
      reasons: customReasons,
    };
  }

  return {
    kind: "classified",
    complexity: "simple",
    points: SIMPLE_CAKE_POINTS,
    reasons: ["Torta sencilla de un piso, sin diseño personalizado complejo."],
  };
}

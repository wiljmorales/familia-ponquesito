import type {
  AssistantProvider,
  AssistantReply,
  AssistantRequest,
} from "./types";

/**
 * Proveedor temporal determinista (Reto 1, sin IA real).
 *
 * Reglas de honestidad — ver docs/challenge-1.md:
 * - Nunca inventa productos, precios, sabores, horarios, zonas, pagos ni
 *   políticas: la base de conocimiento real está en construcción
 *   (docs/familia-ponquesito-discovery.md sigue pendiente de respuestas).
 * - Toda pregunta sobre datos del negocio devuelve "unknown".
 * - La intención de pedir o hablar con alguien devuelve "human_required".
 * - Solo responde "answered" sobre sí mismo (qué es y cómo funciona).
 */

/** Quita acentos y pasa a minúsculas para comparar palabras clave. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Intención de concretar un pedido o de hablar con una persona. */
const HUMAN_INTENT_KEYWORDS = [
  "pedido",
  "pedir",
  "encarg",
  "ordenar",
  "comprar",
  "cotiz",
  "reserv",
  "humano",
  "persona",
  "alguien",
  "asesor",
  "atienda",
  "contact",
  "whatsapp",
  "telefono",
  "llamar",
];

/** Datos del negocio que todavía no existen en la base de conocimiento. */
const BUSINESS_DATA_KEYWORDS = [
  "precio",
  "cuanto",
  "cuesta",
  "valor",
  "tarifa",
  "sabor",
  "producto",
  "ponque",
  "torta",
  "pastel",
  "cupcake",
  "postre",
  "menu",
  "catalogo",
  "venden",
  "horario",
  "hora",
  "abren",
  "cierran",
  "dia",
  "entrega",
  "delivery",
  "domicilio",
  "envio",
  "zona",
  "donde",
  "ubicacion",
  "direccion",
  "pago",
  "pagar",
  "transferencia",
  "efectivo",
  "tarjeta",
  "zelle",
  "descuento",
  "promocion",
  "politica",
  "cancel",
  "reembolso",
  "cambio",
  "ingrediente",
  "alergen",
  "gluten",
  "vegan",
  "azucar",
  "personalizad",
];

/** Preguntas sobre el propio asistente: lo único que sí puede responder. */
const META_KEYWORDS = [
  "hola",
  "buenas",
  "buenos dias",
  "que puedes",
  "que sabes",
  "quien eres",
  "que eres",
  "que es esto",
  "como funciona",
  "para que sirves",
  "ayuda",
];

const REPLY_HUMAN_REQUIRED =
  "Eso es mejor que lo atienda directamente una persona de Familia " +
  "Ponquesito. Yo todavía no puedo gestionar pedidos ni indicarte el canal " +
  "de contacto, porque esa información aún no está en mi base de " +
  "conocimiento. ¡Pronto podré ayudarte con esto!";

const REPLY_UNKNOWN =
  "Todavía no tengo esa información. Mi base de conocimiento con los datos " +
  "reales de Familia Ponquesito está en construcción, y prefiero decirte " +
  "que no lo sé antes que inventar una respuesta. Muy pronto podré " +
  "responderte esto con datos reales.";

const REPLY_META =
  "¡Hola! Soy el asistente de Familia Ponquesito, en mi primera versión. " +
  "Mi base de conocimiento con la información real del negocio está en " +
  "construcción, así que todavía no puedo darte productos, precios ni " +
  "horarios. Lo que sí puedo mostrarte es cómo converso: respondo solo con " +
  "lo que sé, admito lo que no sé y te aviso cuándo conviene hablar con " +
  "una persona.";

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export const temporaryProvider: AssistantProvider = async (
  request: AssistantRequest,
): Promise<AssistantReply> => {
  const text = normalize(request.message);

  if (includesAny(text, HUMAN_INTENT_KEYWORDS)) {
    return { status: "human_required", reply: REPLY_HUMAN_REQUIRED };
  }

  if (includesAny(text, BUSINESS_DATA_KEYWORDS)) {
    return { status: "unknown", reply: REPLY_UNKNOWN };
  }

  if (includesAny(text, META_KEYWORDS)) {
    return { status: "answered", reply: REPLY_META };
  }

  return { status: "unknown", reply: REPLY_UNKNOWN };
};

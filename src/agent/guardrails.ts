import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import { addDaysISO, daysBetweenISO } from "@/lib/business-dates";
import type { PrototypeOrder } from "@/types/prototype";
import {
  AGENT_URGENCIES,
  type AgentDecision,
  type AgentUrgency,
  type GuardrailCorrection,
  type MissingField,
} from "./types";

/**
 * Guardrails deterministas del negocio (Reto 7). La IA interpreta el
 * lenguaje; estas reglas validan la decisión contra las políticas reales
 * (anticipación mínima de 3 días, nada para el mismo día, cambios sujetos
 * a confirmación humana, alergias siempre con intervención humana). Si la
 * decisión del modelo contradice una regla, la regla prevalece y la
 * corrección queda registrada de forma visible.
 */

export interface GuardrailContext {
  message: string;
  /** "YYYY-MM-DD" del día calendario del negocio (America/Caracas). */
  todayISO: string;
  /** Pedidos del prototipo del Reto 5 (para evaluar cambios). */
  orders: PrototypeOrder[];
  /** true cuando el mensaje trae datos de contacto (casos demo simulados). */
  hasContact: boolean;
}

export interface GuardrailResult {
  decision: AgentDecision;
  corrections: GuardrailCorrection[];
}

/**
 * Bajo esta confianza el agente no ejecuta rutas automáticas: decisión de
 * diseño del agente (no una política del negocio) para preferir revisión
 * humana antes que una acción dudosa.
 */
export const MIN_ACTIONABLE_CONFIDENCE = 0.4;

/**
 * Señales de seguridad alimentaria o reclamo. "alerg"/"alérg" cubre
 * alergia, alérgico y alérgeno; "reclam"/"queja" cubre los reclamos.
 */
const SENSITIVE_PATTERN =
  /alerg|alérg|cel[ií]ac|intoleran|intoxica|seguridad alimentaria|reclam|queja/i;

const ORDER_CODE_IN_MESSAGE = /\b(PED-\d{3}|FP-\d-[A-Z0-9]{4})\b/i;

/** Extrae el código de pedido citado en el mensaje (determinista). */
export function extractOrderCode(message: string): string | null {
  const match = ORDER_CODE_IN_MESSAGE.exec(message);
  return match ? match[1].toUpperCase() : null;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
};

const IN_N_DAYS_PATTERN =
  /(?:dentro de|en|para dentro de)\s+(\d{1,2}|[a-záéíóú]+)\s+d[ií]as?\b/i;

/** "mañana" como día siguiente, no como parte del día ("por la mañana"). */
function mentionsTomorrowAsDay(message: string): boolean {
  const pattern = /mañana\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const before = message.slice(Math.max(0, match.index - 12), match.index);
    if (/(?:por|de|en)\s+la\s+$|esta\s+$|las?\s+$|pasado\s+$/i.test(before)) continue;
    return true;
  }
  return false;
}

export interface RelativeDayReference {
  daysUntil: number;
  dateISO: string;
}

/**
 * Referencia relativa de fecha en el mensaje ("mañana", "para hoy",
 * "dentro de ocho días"), resuelta contra el calendario del negocio.
 * Devuelve null si el mensaje no trae ninguna señal clara.
 */
export function extractRelativeDayReference(
  message: string,
  todayISO: string,
): RelativeDayReference | null {
  const build = (daysUntil: number): RelativeDayReference => ({
    daysUntil,
    dateISO: addDaysISO(todayISO, daysUntil),
  });

  if (/\bpasado\s+mañana\b/i.test(message)) return build(2);
  if (mentionsTomorrowAsDay(message)) return build(1);
  if (/\b(?:para|es)\s+hoy\b|\bhoy\s+mismo\b|\bmismo\s+d[ií]a\b/i.test(message)) {
    return build(0);
  }

  const match = IN_N_DAYS_PATTERN.exec(message);
  if (match) {
    const token = match[1].toLowerCase();
    const days = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
    if (days !== undefined && Number.isFinite(days)) return build(days);
  }

  return null;
}

const URGENCY_RANK: Record<AgentUrgency, number> = Object.fromEntries(
  AGENT_URGENCIES.map((urgency, index) => [urgency, index]),
) as Record<AgentUrgency, number>;

function raiseUrgency(current: AgentUrgency, minimum: AgentUrgency): AgentUrgency {
  return URGENCY_RANK[current] >= URGENCY_RANK[minimum] ? current : minimum;
}

/**
 * Aplica las reglas del negocio sobre la decisión (del modelo o del
 * fallback). Devuelve la decisión corregida y la lista de correcciones,
 * cada una visible en la demo. Determinista y sin efectos secundarios.
 */
export function applyBusinessGuardrails(
  decision: AgentDecision,
  context: GuardrailContext,
): GuardrailResult {
  const corrections: GuardrailCorrection[] = [];
  const corrected: AgentDecision = { ...decision, missingFields: [...decision.missingFields] };

  const escalate = (rule: string, description: string, minimum: AgentUrgency) => {
    corrected.route = "human_escalation";
    corrected.requiresHuman = true;
    corrected.urgency = raiseUrgency(corrected.urgency, minimum);
    corrections.push({ rule, description });
  };

  // 1. Código de pedido: la extracción determinista prevalece sobre el
  // modelo, tanto para detectar uno omitido como para descartar uno que no
  // está realmente en el mensaje (anti-invención).
  const codeInMessage = extractOrderCode(context.message);
  if (codeInMessage !== corrected.detectedOrderCode) {
    corrected.detectedOrderCode = codeInMessage;
    corrections.push({
      rule: "codigo-pedido-determinista",
      description: codeInMessage
        ? `El código ${codeInMessage} se detectó en el mensaje por regla determinista.`
        : "El código de pedido reportado por el modelo no está en el mensaje; se descartó.",
    });
  }

  // 2. Fecha relativa explícita ("mañana", "dentro de ocho días"): si el
  // modelo no resolvió la fecha, se completa de forma determinista para que
  // las reglas de anticipación puedan aplicarse.
  const dayReference = extractRelativeDayReference(context.message, context.todayISO);
  if (corrected.detectedCelebrationDate === null && dayReference) {
    corrected.detectedCelebrationDate = dayReference.dateISO;
    corrections.push({
      rule: "fecha-relativa-determinista",
      description: `La fecha mencionada se resolvió por regla determinista a ${dayReference.dateISO}.`,
    });
  }

  // 3. Una consulta general jamás crea un lead.
  if (
    corrected.intent === "general_question" &&
    corrected.route !== "knowledge_answer" &&
    corrected.route !== "human_escalation"
  ) {
    corrected.route = "knowledge_answer";
    corrections.push({
      rule: "consulta-sin-lead",
      description: "Una consulta general se responde con la base de conocimiento; no crea lead.",
    });
  }

  // 4. La máquina de leads exige datos de contacto reales (correo y
  // WhatsApp): sin ellos no se puede registrar nada, así que se piden.
  if (corrected.route === "lead_automation" && !context.hasContact) {
    corrected.route = "request_information";
    if (!corrected.missingFields.includes("contact")) {
      corrected.missingFields.push("contact");
    }
    corrections.push({
      rule: "lead-sin-contacto",
      description:
        "El mensaje no trae datos de contacto: sin correo y WhatsApp no se puede registrar el lead, se solicitan primero.",
    });
  }

  // 4b. La clasificación de prioridad del Reto 4 exige fecha de
  // celebración: sin fecha no hay lead que registrar, se pide primero.
  if (corrected.route === "lead_automation" && corrected.detectedCelebrationDate === null) {
    corrected.route = "request_information";
    if (!corrected.missingFields.includes("celebration_date")) {
      corrected.missingFields.push("celebration_date");
    }
    corrections.push({
      rule: "lead-sin-fecha",
      description:
        "El mensaje no permite fijar la fecha de la celebración: la máquina de leads la necesita para clasificar la prioridad, se solicita primero.",
    });
  }

  // 5. Anticipación mínima: pedidos con menos de 3 días (incluido el mismo
  // día) nunca entran solos a la máquina de leads; los decide Karem.
  if (
    (corrected.intent === "new_order" || corrected.route === "lead_automation") &&
    corrected.detectedCelebrationDate !== null
  ) {
    const daysUntil = daysBetweenISO(context.todayISO, corrected.detectedCelebrationDate);
    if (daysUntil < MIN_LEAD_DAYS) {
      escalate(
        "anticipacion-minima",
        daysUntil <= 0
          ? "Política del negocio: no se aceptan pedidos para el mismo día. El caso pasa a Karem."
          : `Política del negocio: se requieren al menos ${MIN_LEAD_DAYS} días de anticipación (quedan ${daysUntil}). El caso pasa a Karem.`,
        daysUntil <= 1 ? "critical" : "high",
      );
    }
  }

  // 6. Cambios o cancelaciones: nunca se confirman automáticamente (la
  // política exige que la preparación no haya comenzado y eso lo confirma
  // Karem). La urgencia sube con la proximidad real o declarada.
  if (corrected.route === "order_review" || corrected.intent === "order_change_or_cancellation") {
    if (!corrected.requiresHuman) {
      corrected.requiresHuman = true;
      corrections.push({
        rule: "cambio-requiere-confirmacion",
        description:
          "Ningún cambio o cancelación se confirma automáticamente: requiere confirmación de Karem.",
      });
    }

    const order = corrected.detectedOrderCode
      ? context.orders.find((candidate) => candidate.id === corrected.detectedOrderCode)
      : undefined;

    if (order) {
      const daysUntil = daysBetweenISO(context.todayISO, order.celebrationDate);
      if (daysUntil < MIN_LEAD_DAYS) {
        corrected.urgency = raiseUrgency(corrected.urgency, "critical");
        corrections.push({
          rule: "cambio-fecha-proxima",
          description: `La celebración del pedido ${order.id} está a ${daysUntil} día(s): atención inmediata.`,
        });
      }
      if (dayReference && dayReference.dateISO !== order.celebrationDate) {
        corrected.urgency = raiseUrgency(corrected.urgency, "critical");
        corrections.push({
          rule: "cambio-fecha-discrepante",
          description:
            `El mensaje dice que la celebración es el ${dayReference.dateISO}, pero el pedido ` +
            `${order.id} está registrado para el ${order.celebrationDate}: Karem debe verificarlo.`,
        });
      }
    } else if (dayReference && dayReference.daysUntil <= 1) {
      corrected.urgency = raiseUrgency(corrected.urgency, "critical");
      corrections.push({
        rule: "cambio-urgente-declarado",
        description: "El mensaje declara que la celebración es inminente: atención inmediata.",
      });
    }
  }

  // 7. Confianza insuficiente: mejor revisión humana que una ruta dudosa.
  if (
    corrected.confidence < MIN_ACTIONABLE_CONFIDENCE &&
    corrected.route !== "human_escalation" &&
    corrected.route !== "order_review"
  ) {
    escalate(
      "confianza-baja",
      `La confianza del análisis (${corrected.confidence.toFixed(2)}) es demasiado baja para ejecutar una ruta automática.`,
      "high",
    );
  }

  // 8. Seguridad alimentaria y reclamos (al final: nada la des-fuerza).
  // Alergias siempre requieren humano; ninguna ruta automática puede
  // prometer nada al respecto.
  if (SENSITIVE_PATTERN.test(context.message)) {
    const wasAlreadySafe =
      corrected.requiresHuman &&
      (corrected.route === "human_escalation" || corrected.route === "order_review") &&
      URGENCY_RANK[corrected.urgency] >= URGENCY_RANK.high;

    corrected.requiresHuman = true;
    corrected.urgency = raiseUrgency(corrected.urgency, "high");
    if (corrected.route !== "human_escalation" && corrected.route !== "order_review") {
      corrected.route = "human_escalation";
    }

    if (!wasAlreadySafe) {
      corrections.push({
        rule: "seguridad-alimentaria",
        description:
          "El mensaje menciona alergias, seguridad alimentaria o un reclamo: intervención humana obligatoria, sin promesas automáticas.",
      });
    }
  }

  // Invariante final: escalar a humano siempre implica requiresHuman.
  if (corrected.route === "human_escalation") corrected.requiresHuman = true;

  // La ruta de pedir información siempre dice QUÉ falta.
  if (corrected.route === "request_information" && corrected.missingFields.length === 0) {
    const defaults: MissingField[] = ["celebration_date", "guest_count"];
    if (!context.hasContact) defaults.push("contact");
    corrected.missingFields = defaults;
    corrections.push({
      rule: "campos-faltantes-minimos",
      description:
        "El modelo no listó los datos faltantes; se solicitan los esenciales (fecha, personas y contacto si no lo hay).",
    });
  }

  return { decision: corrected, corrections };
}

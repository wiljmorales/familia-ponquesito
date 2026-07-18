"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import { generateReferenceCode } from "@/lib/reference-code";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import { createRateLimiter } from "@/app/api/assistant/rate-limit";
import {
  agendaOrderSchema,
  agendaReservationSchema,
} from "@/lib/validations/agenda-reservation";
import { BOOKING_WINDOW_DAYS, type CapacityPoints } from "@/reservations/capacity";
import {
  classifyOrder,
  HUMAN_REVIEW_PROVISIONAL_POINTS,
  type OrderClassificationInput,
} from "@/reservations/classify-order";
import { findNearbyAlternatives, toDayAvailability } from "@/reservations/availability";
import { monthDateRange } from "@/reservations/calendar";
import {
  createReservation,
  getAvailability,
  type CreateReservationInput,
  type CreateReservationResult,
  type GetAvailabilityResult,
} from "@/reservations/service";
import type { DayAvailability } from "@/reservations/types";
import { absoluteUrl } from "@/lib/site-url";
import { processReservationLead } from "@/leads/service";
import type { ProcessLeadInput, ReservationLeadDetails } from "@/leads/types";
import type { ReservationEmailContext } from "@/email/templates/reservation-types";
import { FORM_FLAVOR_OPTIONS } from "@/lib/constants/business";

/**
 * Server Actions del wizard público /agenda (Reto 8, Etapa 3).
 *
 * El navegador solo envía las RESPUESTAS del cliente: los puntos de
 * capacidad se recalculan aquí con classifyOrder en cada llamada, y la
 * base de datos vuelve a validar todo dentro de la transacción. En esta
 * etapa no se envían correos ni se registra el lead (Etapa 4): por eso el
 * token de gestión que devuelve el servicio se DESCARTA a propósito — sin
 * correo que lo entregue (y sin página de gestión todavía, Etapa 5) no
 * hay dónde ponerlo sin filtrarlo.
 */

const GENERIC_ERROR_MESSAGE =
  "No pudimos consultar la agenda en este momento. Inténtalo de nuevo en unos minutos.";
const RATE_LIMIT_MESSAGE =
  "Recibimos varias solicitudes desde tu conexión. Espera unos minutos antes de intentarlo de nuevo.";

/**
 * Protección básica contra automatización abusiva. En Vercel serverless la
 * memoria no se comparte entre instancias ni regiones, por lo que este límite
 * es una barrera de bajo costo, no una cuota global estricta.
 */
const isReservationAllowedForKey = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60_000,
});

export interface AgendaActionDeps {
  getAvailabilityFn: (
    startDate: string,
    endDate: string,
    capacityPoints: CapacityPoints,
  ) => Promise<GetAvailabilityResult>;
  createReservationFn: (
    input: CreateReservationInput,
  ) => Promise<CreateReservationResult>;
  businessTodayISOFn: () => string;
  isReservationAllowedFn: () => Promise<boolean>;
  scheduleAfterFn: (task: () => Promise<void>) => void;
  processReservationLeadFn: typeof processReservationLead;
}

async function defaultReservationAllowed(): Promise<boolean> {
  const requestHeaders = await headers();
  // Vercel normaliza x-forwarded-for en el borde. Solo se consulta aquí,
  // dentro del servidor; el navegador nunca proporciona una "IP" como dato
  // del formulario ni participa en la decisión del limitador.
  const key =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    "unknown";
  return isReservationAllowedForKey(key);
}

const DEFAULT_DEPS: AgendaActionDeps = {
  getAvailabilityFn: getAvailability,
  createReservationFn: createReservation,
  businessTodayISOFn: businessTodayISO,
  isReservationAllowedFn: defaultReservationAllowed,
  scheduleAfterFn: (task) => after(task),
  processReservationLeadFn: processReservationLead,
};

/**
 * El segundo argumento existe únicamente para pruebas unitarias en Node.
 * En producción se ignora por completo: un cliente de la Server Action no
 * puede sustituir servicios, reloj ni rate limiter.
 */
function actionDeps(overrides?: Partial<AgendaActionDeps>): AgendaActionDeps {
  return process.env.NODE_ENV === "test"
    ? { ...DEFAULT_DEPS, ...overrides }
    : DEFAULT_DEPS;
}

interface ClassifiedOrder {
  input: OrderClassificationInput;
  humanReview: boolean;
  points: CapacityPoints;
  reasons: string[];
}

function classifyFromValues(values: {
  guestCount: number;
  tiers: "one" | "two_or_more";
  isCustomDesign: "yes" | "no";
  hasReferenceImage: "yes" | "no";
  designDescription: string;
}): ClassifiedOrder {
  const input: OrderClassificationInput = {
    guestCount: values.guestCount,
    tiers: values.tiers,
    isCustomDesign: values.isCustomDesign === "yes",
    hasReferenceImage: values.hasReferenceImage === "yes",
    designDescription: values.designDescription,
  };
  const classification = classifyOrder(input);
  if (classification.kind === "human_required") {
    // La disponibilidad se consulta de forma provisional con la carga
    // máxima; la solicitud no consumirá capacidad (nace human_review).
    return {
      input,
      humanReview: true,
      points: HUMAN_REVIEW_PROVISIONAL_POINTS,
      reasons: classification.reasons,
    };
  }
  return {
    input,
    humanReview: false,
    points: classification.points,
    reasons: classification.reasons,
  };
}

export type AgendaAvailabilityResult =
  | {
      ok: true;
      todayISO: string;
      /** true si el pedido requiere revisión humana (disponibilidad provisional). */
      humanReview: boolean;
      days: DayAvailability[];
    }
  | { ok: false; message: string };

/**
 * Disponibilidad de un mes "YYYY-MM" para el pedido descrito en el paso 1.
 * Siempre consulta al backend (nunca cachea en el navegador): el estado de
 * cada día refleja la base de datos en este momento.
 */
export async function fetchAgendaAvailability(
  rawOrder: unknown,
  monthISO: string,
  testDeps?: Partial<AgendaActionDeps>,
): Promise<AgendaAvailabilityResult> {
  const deps = actionDeps(testDeps);
  if (typeof monthISO !== "string" || !/^\d{4}-\d{2}$/.test(monthISO)) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  const parsedOrder = agendaOrderSchema.safeParse(rawOrder);
  if (!parsedOrder.success) {
    return { ok: false, message: "Completa primero los datos de tu torta." };
  }

  const { humanReview, points } = classifyFromValues(parsedOrder.data);
  const todayISO = deps.businessTodayISOFn();
  const { startISO, endISO } = monthDateRange(monthISO);

  // Los días pasados no se consultan (la cuadrícula los pinta apagados);
  // los futuros fuera de la ventana sí, para poder explicar POR QUÉ no
  // se pueden elegir (estado out_of_window).
  const queryStart = startISO < todayISO ? todayISO : startISO;
  if (queryStart > endISO) {
    return { ok: true, todayISO, humanReview, days: [] };
  }

  const result = await deps.getAvailabilityFn(queryStart, endISO, points);
  if (!result.ok) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  return {
    ok: true,
    todayISO,
    humanReview,
    days: result.days.map((row) => toDayAvailability(row, { todayISO, points })),
  };
}

export type SubmitAgendaReservationResult =
  | {
      ok: true;
      code: string;
      celebrationDate: string;
      /** "pending_deposit" (reserva real) o "human_review" (solicitud). */
      status: "pending_deposit" | "human_review";
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string>;
      /**
       * Presente cuando la fecha elegida dejó de estar disponible entre la
       * selección y el envío: hasta 3 fechas cercanas consultadas AHORA.
       */
      alternatives?: { date: string; isLastSlot: boolean }[];
    };

const DATE_ERROR_MESSAGES: Record<string, string> = {
  capacity_unavailable:
    "Esa fecha se acaba de llenar: alguien reservó el espacio antes que tú. Elige una de las fechas cercanas con espacio.",
  date_blocked:
    "Ese día no estamos horneando. Elige una de las fechas cercanas con espacio.",
  too_soon: `Necesitamos al menos ${MIN_LEAD_DAYS} días de anticipación para preparar tu torta.`,
  out_of_window: `Por ahora agendamos hasta ${BOOKING_WINDOW_DAYS} días hacia adelante.`,
};

export async function submitAgendaReservation(
  raw: unknown,
  testDeps?: Partial<AgendaActionDeps>,
): Promise<SubmitAgendaReservationResult> {
  const deps = actionDeps(testDeps);
  // Campo trampa para spam: se responde como si todo hubiera salido bien,
  // sin escribir nada (el código mostrado no corresponde a ninguna reserva).
  const honeypot =
    raw != null && typeof raw === "object" && "companyWebsite" in raw
      ? (raw as { companyWebsite?: unknown }).companyWebsite
      : "";
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return {
      ok: true,
      code: generateReferenceCode("FP-8"),
      celebrationDate: deps.businessTodayISOFn(),
      status: "pending_deposit",
    };
  }

  if (!(await deps.isReservationAllowedFn())) {
    return { ok: false, message: RATE_LIMIT_MESSAGE };
  }

  const parsed = agendaReservationSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      ok: false,
      message: "Revisa los datos marcados en el formulario.",
      fieldErrors,
    };
  }

  const values = parsed.data;
  const { input, humanReview, points, reasons } = classifyFromValues(values);
  const status = humanReview ? "human_review" : "pending_deposit";

  const result = await deps.createReservationFn({
    celebrationDate: values.celebrationDate,
    capacityPoints: points,
    status,
    customerName: values.customerName,
    customerEmail: values.email,
    customerPhone: values.phone,
    guestCount: values.guestCount,
    flavor: values.flavor,
    theme: values.theme,
    fulfillmentType: values.fulfillmentType,
    deliveryDetails: values.deliveryDetails,
    orderDetails: {
      answers: {
        guestCount: values.guestCount,
        tiers: values.tiers,
        isCustomDesign: input.isCustomDesign,
        hasReferenceImage: input.hasReferenceImage,
        designDescription: values.designDescription,
        flavor: values.flavor,
        theme: values.theme ?? null,
      },
      classification: { humanReview, points, reasons },
    },
  });

  if (result.ok) {
    const reservation = reservationLeadDetails(values, {
      code: result.code,
      status,
      points,
      reasons,
    });
    const emailContext: ReservationEmailContext = {
      manageUrl: absoluteUrl(
        `/agenda/reservas/${encodeURIComponent(result.code)}?token=${encodeURIComponent(result.manageToken)}`,
      ),
      capacity: {
        total: result.capacityTotal,
        used: result.capacityUsed,
        remaining: result.capacityRemaining,
        provisional: status === "human_review",
      },
    };
    const leadInput: ProcessLeadInput & {
      source: "cake_reservation";
      referenceCode: string;
      reservation: ReservationLeadDetails;
    } = {
      source: "cake_reservation",
      sourceId: result.reservationId,
      referenceCode: result.code,
      customerName: values.customerName,
      customerWhatsapp: values.phone,
      customerEmail: values.email,
      celebrationDate: values.celebrationDate,
      summaryLines: reservationSummaryLines(reservation),
      normalizedPayload: { ...reservation },
      reservation,
    };

    // El closure conserva el token solo en memoria. after() extiende la
    // invocación serverless sin bloquear la respuesta del wizard.
    deps.scheduleAfterFn(() =>
      deps.processReservationLeadFn(leadInput, emailContext),
    );

    return {
      ok: true,
      code: result.code,
      celebrationDate: values.celebrationDate,
      status,
    };
  }

  const dateErrorMessage = DATE_ERROR_MESSAGES[result.error];
  if (dateErrorMessage) {
    return {
      ok: false,
      message: dateErrorMessage,
      alternatives: await findAlternativesFor(values.celebrationDate, points, deps),
    };
  }

  return { ok: false, message: GENERIC_ERROR_MESSAGE };
}

function reservationLeadDetails(
  values: {
    celebrationDate: string;
    guestCount: number;
    flavor: string;
    theme?: string;
    designDescription: string;
    fulfillmentType: "pickup" | "delivery";
    deliveryDetails?: string;
    hasReferenceImage: "yes" | "no";
  },
  classification: {
    code: string;
    status: "pending_deposit" | "human_review";
    points: CapacityPoints;
    reasons: string[];
  },
): ReservationLeadDetails {
  return {
    code: classification.code,
    celebrationDate: values.celebrationDate,
    status: classification.status,
    capacityPoints: classification.points,
    classificationReasons: classification.reasons,
    guestCount: values.guestCount,
    flavorLabel:
      FORM_FLAVOR_OPTIONS.find((option) => option.value === values.flavor)?.label ??
      values.flavor,
    theme: values.theme,
    designDescription: values.designDescription,
    fulfillmentType: values.fulfillmentType,
    deliveryDetails: values.deliveryDetails,
    hasReferenceImage: values.hasReferenceImage === "yes",
  };
}

function reservationSummaryLines(reservation: ReservationLeadDetails): string[] {
  return [
    `${reservation.guestCount} personas · ${reservation.flavorLabel}`,
    reservation.theme ? `Temática: ${reservation.theme}` : "Sin temática indicada",
    reservation.fulfillmentType === "delivery"
      ? `Delivery: ${reservation.deliveryDetails}`
      : "Retiro por el cliente",
    `Diseño: ${reservation.designDescription}`,
  ];
}

/**
 * Alternativas cercanas consultadas AHORA (nunca con datos viejos del
 * navegador): toda la ventana de reserva, filtrada a días que aceptan el
 * pedido, ordenada por cercanía a la fecha pedida.
 */
async function findAlternativesFor(
  requestedDateISO: string,
  points: CapacityPoints,
  deps: AgendaActionDeps,
): Promise<{ date: string; isLastSlot: boolean }[]> {
  const todayISO = deps.businessTodayISOFn();
  const result = await deps.getAvailabilityFn(
    addDaysISO(todayISO, MIN_LEAD_DAYS),
    addDaysISO(todayISO, BOOKING_WINDOW_DAYS),
    points,
  );
  if (!result.ok) return [];

  const days = result.days.map((row) => toDayAvailability(row, { todayISO, points }));
  return findNearbyAlternatives(days, requestedDateISO).map((day) => ({
    date: day.date,
    isLastSlot: day.isLastSlot,
  }));
}

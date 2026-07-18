"use server";

import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import { generateReferenceCode } from "@/lib/reference-code";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";
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
import { createReservation, getAvailability } from "@/reservations/service";
import type { DayAvailability } from "@/reservations/types";

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
): Promise<AgendaAvailabilityResult> {
  if (typeof monthISO !== "string" || !/^\d{4}-\d{2}$/.test(monthISO)) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  const parsedOrder = agendaOrderSchema.safeParse(rawOrder);
  if (!parsedOrder.success) {
    return { ok: false, message: "Completa primero los datos de tu torta." };
  }

  const { humanReview, points } = classifyFromValues(parsedOrder.data);
  const todayISO = businessTodayISO();
  const { startISO, endISO } = monthDateRange(monthISO);

  // Los días pasados no se consultan (la cuadrícula los pinta apagados);
  // los futuros fuera de la ventana sí, para poder explicar POR QUÉ no
  // se pueden elegir (estado out_of_window).
  const queryStart = startISO < todayISO ? todayISO : startISO;
  if (queryStart > endISO) {
    return { ok: true, todayISO, humanReview, days: [] };
  }

  const result = await getAvailability(queryStart, endISO, points);
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
): Promise<SubmitAgendaReservationResult> {
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
      celebrationDate: businessTodayISO(),
      status: "pending_deposit",
    };
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

  const result = await createReservation({
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
    // result.manageToken se descarta a propósito en esta etapa (ver nota
    // del encabezado): nunca se registra ni se muestra.
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
      alternatives: await findAlternativesFor(values.celebrationDate, points),
    };
  }

  return { ok: false, message: GENERIC_ERROR_MESSAGE };
}

/**
 * Alternativas cercanas consultadas AHORA (nunca con datos viejos del
 * navegador): toda la ventana de reserva, filtrada a días que aceptan el
 * pedido, ordenada por cercanía a la fecha pedida.
 */
async function findAlternativesFor(
  requestedDateISO: string,
  points: CapacityPoints,
): Promise<{ date: string; isLastSlot: boolean }[]> {
  const todayISO = businessTodayISO();
  const result = await getAvailability(
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

/**
 * Cálculos y validaciones de la cotización del prototipo (Reto 5). Todo es
 * lógica pura para poder probarla en Vitest (entorno node) sin renderizar
 * componentes. Los montos son ficticios y se muestran en US$ como moneda
 * de referencia (decisión de prototipo: no hay precios reales confirmados).
 */

import {
  BUSINESS_NAME,
  DEPOSIT_PERCENT,
  MIN_LEAD_DAYS,
  PAYMENT_METHODS,
} from "@/lib/constants/business";
import { formatDateEs } from "@/email/format-date";
import type { PrototypeOrder, QuoteInput } from "@/types/prototype";
import { addDaysISO } from "./dates";

export interface QuoteTotals {
  /** Base + decoración + delivery (si está activo), antes del descuento. */
  subtotal: number;
  total: number;
  /** Anticipo para reservar: el 50 % real del negocio (DEPOSIT_PERCENT). */
  deposit: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeQuoteTotals(input: QuoteInput): QuoteTotals {
  const delivery = input.deliveryEnabled ? input.deliveryPrice : 0;
  const subtotal = round2(input.basePrice + input.decorationPrice + delivery);
  const total = round2(Math.max(subtotal - input.discount, 0));
  const deposit = round2((total * DEPOSIT_PERCENT) / 100);
  return { subtotal, total, deposit };
}

export type QuoteErrors = Partial<
  Record<"basePrice" | "decorationPrice" | "deliveryPrice" | "discount" | "confirmDeadline", string>
>;

export interface QuoteContext {
  /** "YYYY-MM-DD": día calendario del negocio en que corre la demo. */
  baseDate: string;
  /** "YYYY-MM-DD": fecha de celebración del pedido cotizado. */
  celebrationDate: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Última fecha límite admisible para confirmar con el anticipo: la reserva
 * exige el 50 % y el negocio necesita MIN_LEAD_DAYS días de anticipación,
 * así que confirmar después de (celebración − 3 días) ya no sirve.
 */
export function latestConfirmDeadline(celebrationDate: string): string {
  return addDaysISO(celebrationDate, -MIN_LEAD_DAYS);
}

/** Fecha límite propuesta: pasado mañana, recortada al máximo admisible. */
export function defaultConfirmDeadline(baseDate: string, celebrationDate: string): string {
  const latest = latestConfirmDeadline(celebrationDate);
  const preferred = addDaysISO(baseDate, 2);
  // Los "YYYY-MM-DD" se comparan bien como strings.
  if (preferred <= latest) return preferred;
  return latest >= baseDate ? latest : baseDate;
}

export function validateQuote(input: QuoteInput, context: QuoteContext): QuoteErrors {
  const errors: QuoteErrors = {};

  if (!Number.isFinite(input.basePrice) || input.basePrice <= 0) {
    errors.basePrice = "Indica el precio base de la torta.";
  }
  if (!Number.isFinite(input.decorationPrice) || input.decorationPrice < 0) {
    errors.decorationPrice = "La decoración no puede ser un monto negativo.";
  }
  if (
    input.deliveryEnabled &&
    (!Number.isFinite(input.deliveryPrice) || input.deliveryPrice < 0)
  ) {
    errors.deliveryPrice = "El delivery no puede ser un monto negativo.";
  }
  if (!Number.isFinite(input.discount) || input.discount < 0) {
    errors.discount = "El descuento no puede ser negativo.";
  } else if (Object.keys(errors).length === 0) {
    const { subtotal } = computeQuoteTotals(input);
    if (input.discount >= subtotal && subtotal > 0) {
      errors.discount = "El descuento no puede ser igual o mayor al total.";
    }
  }

  if (!input.confirmDeadline || !ISO_DATE_PATTERN.test(input.confirmDeadline)) {
    errors.confirmDeadline = "Indica la fecha límite para confirmar.";
  } else if (input.confirmDeadline < context.baseDate) {
    errors.confirmDeadline = "La fecha límite no puede quedar en el pasado.";
  } else if (input.confirmDeadline > latestConfirmDeadline(context.celebrationDate)) {
    errors.confirmDeadline = `Debe ser al menos ${MIN_LEAD_DAYS} días antes de la celebración (anticipación mínima del negocio).`;
  }

  return errors;
}

export function isQuoteValid(input: QuoteInput, context: QuoteContext): boolean {
  return Object.keys(validateQuote(input, context)).length === 0;
}

/** "US$ 120" para enteros, "US$ 120,50" con decimales (coma, como en es-VE). */
export function formatMoney(value: number): string {
  const rounded = round2(value);
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(".", ",");
  return `US$ ${text}`;
}

/**
 * Mensaje simulado que Karem "enviaría" al cliente. Solo usa datos ya
 * confirmados del negocio: reserva del 50 % y métodos de pago reales.
 */
export function buildCustomerMessage(order: PrototypeOrder, input: QuoteInput): string {
  const { total, deposit } = computeQuoteTotals(input);

  const lines = [
    `¡Hola, ${order.customerName}! Gracias por tu solicitud a ${BUSINESS_NAME}. 🎂`,
    "",
    `Tu torta: ${order.cakeDescription} (${order.flavor.toLowerCase()}, ` +
      `para ${order.guestCount} invitados), para el ${formatDateEs(order.celebrationDate)}.`,
    "",
    `Total: ${formatMoney(total)}`,
    `Anticipo para reservar (${DEPOSIT_PERCENT} %): ${formatMoney(deposit)}`,
    `Fecha límite para confirmar: ${formatDateEs(input.confirmDeadline)}`,
    "",
    `La reserva se confirma con el ${DEPOSIT_PERCENT} % del monto. ` +
      `Métodos de pago: ${PAYMENT_METHODS.join(", ")}.`,
  ];

  if (input.deliveryEnabled) {
    lines.push("El total incluye el delivery (por la app Vamos).");
  }

  const note = input.personalNote.trim();
  if (note) {
    lines.push("", note);
  }

  lines.push("", `Hecho con amor, para compartir. — ${BUSINESS_NAME}`);

  return lines.join("\n");
}

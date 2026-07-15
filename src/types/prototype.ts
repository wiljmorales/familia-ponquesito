/**
 * Tipos del prototipo "Centro de pedidos" (Reto 5). Todo lo que pasa por
 * aquí son datos de demostración: no hay backend, ni envíos reales, ni
 * conexión con los leads de los retos anteriores (ver docs/challenge-5.md).
 */

export const ORDER_STATUSES = [
  "new",
  "reviewing",
  "to_quote",
  "waiting_deposit",
  "confirmed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PROTOTYPE_SCREENS = [
  "intro",
  "dashboard",
  "request-detail",
  "quote-form",
  "quote-sent",
] as const;

export type PrototypeScreen = (typeof PROTOTYPE_SCREENS)[number];

/** Filtro del dashboard: un estado concreto o todos. */
export type StatusFilter = OrderStatus | "all";

/**
 * Nivel de atención derivado de los días que faltan para la celebración,
 * con los mismos umbrales del clasificador real de leads (Reto 4). Nunca
 * hay "not_viable" porque los datos demo siempre respetan la anticipación
 * mínima.
 */
export type OrderAttention = "urgent" | "high" | "normal";

export interface PrototypeOrder {
  /** Identificador visible en la demo, p. ej. "PED-001". */
  id: string;
  /** Nombre ficticio; la UI siempre muestra "Datos de demostración". */
  customerName: string;
  /** Contacto claramente ficticio: "0412-0000000". */
  whatsapp: string;
  /** Label de CELEBRATION_TYPES (constantes reales del negocio). */
  celebrationType: string;
  /** "YYYY-MM-DD", siempre a ≥ 3 días de la fecha base de la demo. */
  celebrationDate: string;
  guestCount: number;
  /** Label de FLAVORS (los cuatro sabores reales confirmados). */
  flavor: string;
  cakeDescription: string;
  deliveryMethod: "retiro" | "delivery";
  /** Zona de entrega; null cuando el pedido es retiro en persona. */
  zone: string | null;
  /** Referencia visual simulada (no hay imágenes reales de clientes). */
  visualReference: string;
  /** "YYYY-MM-DD" en que llegó la solicitud (≤ fecha base). */
  receivedDate: string;
  status: OrderStatus;
  notes: string;
  /** Pedido preparado para recorrer el flujo completo de la demostración. */
  isDemoFlowOrder: boolean;
}

/** Lo que Karem escribe en el formulario de cotización. */
export interface QuoteInput {
  basePrice: number;
  decorationPrice: number;
  deliveryEnabled: boolean;
  deliveryPrice: number;
  discount: number;
  /** "YYYY-MM-DD": fecha límite para confirmar con el anticipo. */
  confirmDeadline: string;
  /** Nota personal opcional que se añade al mensaje generado. */
  personalNote: string;
}

/** Resultado de la cotización "enviada" (simulada) para la pantalla final. */
export interface SentQuote {
  orderId: string;
  total: number;
  deposit: number;
  confirmDeadline: string;
  message: string;
}

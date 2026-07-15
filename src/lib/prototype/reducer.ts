/**
 * Máquina de estados del prototipo (Reto 5): una sola ruta (/prototipo)
 * cuya navegación se controla por estado con useReducer. El reducer es
 * puro (sin sessionStorage ni efectos) para poder probarlo en node; la
 * persistencia vive en storage.ts y la conecta el orquestador cliente.
 */

import { createPrototypeOrders } from "@/data/prototype-orders";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";
import type {
  OrderAttention,
  OrderStatus,
  PrototypeOrder,
  PrototypeScreen,
  QuoteInput,
  SentQuote,
  StatusFilter,
} from "@/types/prototype";
import { daysBetweenISO } from "./dates";
import { buildCustomerMessage, computeQuoteTotals, isQuoteValid } from "./quote";

export interface PrototypeState {
  /** "YYYY-MM-DD": día calendario del negocio; fija todas las fechas demo. */
  baseDate: string;
  screen: PrototypeScreen;
  orders: PrototypeOrder[];
  selectedOrderId: string | null;
  statusFilter: StatusFilter;
  /** Cotización "enviada" (simulada) que muestra la pantalla final. */
  sentQuote: SentQuote | null;
}

export type PrototypeAction =
  | { type: "enter_dashboard" }
  | { type: "go_intro" }
  | { type: "view_order"; orderId: string }
  | { type: "back_to_dashboard" }
  | { type: "set_filter"; filter: StatusFilter }
  | { type: "start_quote" }
  | { type: "cancel_quote" }
  | { type: "send_quote"; input: QuoteInput }
  | { type: "apply_overrides"; overrides: Record<string, OrderStatus> }
  | { type: "reset" };

/**
 * Estado inicial de la demo. `statusOverrides` (cargado de sessionStorage)
 * re-aplica los cambios de estado que sobrevivieron a una recarga; los ids
 * desconocidos se ignoran.
 */
export function createInitialState(
  baseDate: string,
  statusOverrides: Record<string, OrderStatus> | null = null,
): PrototypeState {
  const orders = createPrototypeOrders(baseDate).map((order) => {
    const override = statusOverrides?.[order.id];
    return override ? { ...order, status: override } : order;
  });

  return {
    baseDate,
    screen: "intro",
    orders,
    selectedOrderId: null,
    statusFilter: "all",
    sentQuote: null,
  };
}

export function selectedOrder(state: PrototypeState): PrototypeOrder | null {
  return state.orders.find((order) => order.id === state.selectedOrderId) ?? null;
}

export function prototypeReducer(
  state: PrototypeState,
  action: PrototypeAction,
): PrototypeState {
  switch (action.type) {
    case "enter_dashboard":
      return { ...state, screen: "dashboard" };

    case "go_intro":
      return { ...state, screen: "intro" };

    case "view_order": {
      const exists = state.orders.some((order) => order.id === action.orderId);
      if (!exists) return state;
      return { ...state, screen: "request-detail", selectedOrderId: action.orderId };
    }

    case "back_to_dashboard":
      return { ...state, screen: "dashboard", selectedOrderId: null, sentQuote: null };

    case "set_filter":
      return { ...state, statusFilter: action.filter };

    case "start_quote": {
      const order = selectedOrder(state);
      if (!order || !canPrepareQuote(order.status)) return state;
      return { ...state, screen: "quote-form" };
    }

    case "cancel_quote":
      return { ...state, screen: "request-detail" };

    case "send_quote": {
      const order = selectedOrder(state);
      if (!order) return state;
      // Doble barrera junto al formulario: con datos inválidos no se avanza.
      const context = { baseDate: state.baseDate, celebrationDate: order.celebrationDate };
      if (!isQuoteValid(action.input, context)) return state;

      const { total, deposit } = computeQuoteTotals(action.input);
      const sentQuote: SentQuote = {
        orderId: order.id,
        total,
        deposit,
        confirmDeadline: action.input.confirmDeadline,
        message: buildCustomerMessage(order, action.input),
      };

      return {
        ...state,
        screen: "quote-sent",
        sentQuote,
        orders: state.orders.map((item) =>
          item.id === order.id ? { ...item, status: "waiting_deposit" } : item,
        ),
      };
    }

    // Re-aplica los cambios guardados en sessionStorage. Se despacha desde
    // un efecto tras el montaje (nunca en el primer render) para que el
    // HTML del servidor y la hidratación del cliente coincidan siempre.
    case "apply_overrides": {
      let changed = false;
      const orders = state.orders.map((order) => {
        const override = action.overrides[order.id];
        if (!override || override === order.status) return order;
        changed = true;
        return { ...order, status: override };
      });
      return changed ? { ...state, orders } : state;
    }

    case "reset":
      return createInitialState(state.baseDate);
  }
}

/**
 * Estados desde los que tiene sentido preparar una cotización: una vez
 * enviada (waiting_deposit) o confirmado el pedido, la acción desaparece.
 * La UI y el reducer usan esta misma regla (doble barrera).
 */
const QUOTABLE_STATUSES: readonly OrderStatus[] = ["new", "reviewing", "to_quote"];

export function canPrepareQuote(status: OrderStatus): boolean {
  return QUOTABLE_STATUSES.includes(status);
}

/**
 * Pantalla segura para renderizar. Ninguna combinación normal de acciones
 * produce estados inconsistentes (el reducer los previene), pero si algo
 * quedara raro (p. ej. una pantalla que exige pedido sin selección, o una
 * confirmación sin cotización enviada) la app se recupera al dashboard en
 * vez de quedar en blanco.
 */
export function recoverScreen(state: PrototypeState): PrototypeScreen {
  const needsOrder =
    state.screen === "request-detail" ||
    state.screen === "quote-form" ||
    state.screen === "quote-sent";
  if (needsOrder && !selectedOrder(state)) return "dashboard";
  if (state.screen === "quote-sent" && !state.sentQuote) return "dashboard";
  return state.screen;
}

export function filterOrders(
  orders: PrototypeOrder[],
  filter: StatusFilter,
): PrototypeOrder[] {
  if (filter === "all") return orders;
  return orders.filter((order) => order.status === filter);
}

export function countByStatus(orders: PrototypeOrder[]): Record<OrderStatus, number> {
  const counts: Record<OrderStatus, number> = {
    new: 0,
    reviewing: 0,
    to_quote: 0,
    waiting_deposit: 0,
    confirmed: 0,
  };
  for (const order of orders) counts[order.status] += 1;
  return counts;
}

export interface DashboardIndicators {
  newCount: number;
  toQuoteCount: number;
  waitingDepositCount: number;
  /** Pedidos confirmados con entrega en los próximos 7 días. */
  upcomingDeliveries: number;
}

export function dashboardIndicators(
  orders: PrototypeOrder[],
  baseDate: string,
): DashboardIndicators {
  const counts = countByStatus(orders);
  const upcomingDeliveries = orders.filter((order) => {
    if (order.status !== "confirmed") return false;
    const daysUntil = daysBetweenISO(baseDate, order.celebrationDate);
    return daysUntil >= 0 && daysUntil <= 7;
  }).length;

  return {
    newCount: counts.new,
    toQuoteCount: counts.to_quote,
    waitingDepositCount: counts.waiting_deposit,
    upcomingDeliveries,
  };
}

/** Última anticipación clasificada como "high" (umbral del Reto 4). */
const HIGH_ATTENTION_MAX_DAYS = 10;

/**
 * Nivel de atención derivado de los días disponibles, con los mismos
 * umbrales del clasificador real de leads (src/leads/classify.ts). No se
 * inventa una prioridad almacenada: se calcula de las fechas.
 */
export function orderAttention(baseDate: string, celebrationDate: string): OrderAttention {
  const daysUntil = daysBetweenISO(baseDate, celebrationDate);
  if (daysUntil <= MIN_LEAD_DAYS + 1) return "urgent";
  if (daysUntil <= HIGH_ATTENTION_MAX_DAYS) return "high";
  return "normal";
}

import { describe, expect, it } from "vitest";
import type { QuoteInput } from "@/types/prototype";
import { createPrototypeOrders } from "@/data/prototype-orders";
import {
  countByStatus,
  createInitialState,
  dashboardIndicators,
  filterOrders,
  orderAttention,
  prototypeReducer,
  selectedOrder,
  type PrototypeState,
} from "./reducer";

const BASE_DATE = "2026-03-10";

// PED-001: el pedido preparado para el flujo completo (nuevo, base + 9).
const DEMO_ORDER_ID = "PED-001";

const VALID_QUOTE: QuoteInput = {
  basePrice: 80,
  decorationPrice: 25,
  deliveryEnabled: true,
  deliveryPrice: 5,
  discount: 0,
  confirmDeadline: "2026-03-12",
  personalNote: "",
};

/** Estado con el pedido de la demo abierto en el detalle. */
function stateAtDetail(): PrototypeState {
  let state = createInitialState(BASE_DATE);
  state = prototypeReducer(state, { type: "enter_dashboard" });
  return prototypeReducer(state, { type: "view_order", orderId: DEMO_ORDER_ID });
}

/** Estado con el formulario de cotización abierto. */
function stateAtQuoteForm(): PrototypeState {
  return prototypeReducer(stateAtDetail(), { type: "start_quote" });
}

describe("createInitialState", () => {
  it("arranca en la portada con los cinco pedidos y sin filtro", () => {
    const state = createInitialState(BASE_DATE);
    expect(state.screen).toBe("intro");
    expect(state.orders).toHaveLength(5);
    expect(state.selectedOrderId).toBeNull();
    expect(state.statusFilter).toBe("all");
    expect(state.sentQuote).toBeNull();
  });

  it("aplica overrides de estado guardados, ignorando ids desconocidos", () => {
    const state = createInitialState(BASE_DATE, {
      [DEMO_ORDER_ID]: "waiting_deposit",
      "PED-999": "confirmed",
    });
    expect(state.orders.find((order) => order.id === DEMO_ORDER_ID)?.status).toBe(
      "waiting_deposit",
    );
    expect(state.orders.some((order) => order.id === "PED-999")).toBe(false);
  });
});

describe("navegación entre pantallas", () => {
  it("la portada permite entrar al centro de pedidos", () => {
    const state = prototypeReducer(createInitialState(BASE_DATE), {
      type: "enter_dashboard",
    });
    expect(state.screen).toBe("dashboard");
  });

  it("abre el detalle de un pedido existente", () => {
    const state = stateAtDetail();
    expect(state.screen).toBe("request-detail");
    expect(selectedOrder(state)?.id).toBe(DEMO_ORDER_ID);
  });

  it("ignora abrir un pedido inexistente", () => {
    const before = createInitialState(BASE_DATE);
    const after = prototypeReducer(before, { type: "view_order", orderId: "PED-999" });
    expect(after).toBe(before);
  });

  it("desde el detalle se abre el formulario de cotización", () => {
    expect(stateAtQuoteForm().screen).toBe("quote-form");
  });

  it("no abre el formulario sin un pedido seleccionado", () => {
    const before = createInitialState(BASE_DATE);
    expect(prototypeReducer(before, { type: "start_quote" })).toBe(before);
  });

  it("cancelar la cotización vuelve al detalle", () => {
    const state = prototypeReducer(stateAtQuoteForm(), { type: "cancel_quote" });
    expect(state.screen).toBe("request-detail");
    expect(selectedOrder(state)?.id).toBe(DEMO_ORDER_ID);
  });

  it("volver al centro limpia la selección y la cotización mostrada", () => {
    const state = prototypeReducer(stateAtDetail(), { type: "back_to_dashboard" });
    expect(state.screen).toBe("dashboard");
    expect(state.selectedOrderId).toBeNull();
    expect(state.sentQuote).toBeNull();
  });
});

describe("filtros del dashboard", () => {
  it("cambia el filtro activo y filterOrders lo aplica", () => {
    const state = prototypeReducer(createInitialState(BASE_DATE), {
      type: "set_filter",
      filter: "new",
    });
    expect(state.statusFilter).toBe("new");

    const visible = filterOrders(state.orders, state.statusFilter);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(DEMO_ORDER_ID);
  });

  it("el filtro 'all' muestra todos los pedidos", () => {
    const state = createInitialState(BASE_DATE);
    expect(filterOrders(state.orders, "all")).toHaveLength(5);
  });
});

describe("send_quote: la interacción central del reto", () => {
  it("con datos válidos avanza a la confirmación y el pedido pasa a waiting_deposit", () => {
    const state = prototypeReducer(stateAtQuoteForm(), {
      type: "send_quote",
      input: VALID_QUOTE,
    });

    expect(state.screen).toBe("quote-sent");
    expect(selectedOrder(state)?.status).toBe("waiting_deposit");
    expect(state.sentQuote).toMatchObject({
      orderId: DEMO_ORDER_ID,
      total: 110,
      deposit: 55,
      confirmDeadline: "2026-03-12",
    });
    expect(state.sentQuote?.message).toContain("US$ 110");
  });

  it("no avanza con datos inválidos", () => {
    const before = stateAtQuoteForm();
    const after = prototypeReducer(before, {
      type: "send_quote",
      input: { ...VALID_QUOTE, basePrice: 0 },
    });
    expect(after).toBe(before);
    expect(selectedOrder(after)?.status).toBe("new");
  });

  it("al volver al centro el nuevo estado es visible en conteos y filtro", () => {
    let state = prototypeReducer(stateAtQuoteForm(), {
      type: "send_quote",
      input: VALID_QUOTE,
    });
    state = prototypeReducer(state, { type: "back_to_dashboard" });

    expect(state.screen).toBe("dashboard");
    const counts = countByStatus(state.orders);
    expect(counts.new).toBe(0);
    expect(counts.waiting_deposit).toBe(2); // PED-004 + el recién cotizado

    const waiting = filterOrders(state.orders, "waiting_deposit");
    expect(waiting.map((order) => order.id)).toContain(DEMO_ORDER_ID);
  });

  it("actualiza los indicadores superiores", () => {
    const before = dashboardIndicators(createInitialState(BASE_DATE).orders, BASE_DATE);
    expect(before).toEqual({
      newCount: 1,
      toQuoteCount: 1,
      waitingDepositCount: 1,
      upcomingDeliveries: 1, // PED-005, confirmado a 5 días
    });

    const after = prototypeReducer(stateAtQuoteForm(), {
      type: "send_quote",
      input: VALID_QUOTE,
    });
    const indicators = dashboardIndicators(after.orders, BASE_DATE);
    expect(indicators.newCount).toBe(0);
    expect(indicators.waitingDepositCount).toBe(2);
  });
});

describe("reset: reiniciar la demo", () => {
  it("restaura los pedidos originales y vuelve a la portada", () => {
    let state = prototypeReducer(stateAtQuoteForm(), {
      type: "send_quote",
      input: VALID_QUOTE,
    });
    state = prototypeReducer(state, { type: "reset" });

    expect(state.screen).toBe("intro");
    expect(state.selectedOrderId).toBeNull();
    expect(state.sentQuote).toBeNull();
    expect(state.orders).toEqual(createPrototypeOrders(BASE_DATE));
  });
});

describe("orderAttention", () => {
  it("deriva el nivel de atención con los umbrales del Reto 4", () => {
    expect(orderAttention(BASE_DATE, "2026-03-14")).toBe("urgent"); // 4 días
    expect(orderAttention(BASE_DATE, "2026-03-15")).toBe("high"); // 5 días
    expect(orderAttention(BASE_DATE, "2026-03-20")).toBe("high"); // 10 días
    expect(orderAttention(BASE_DATE, "2026-03-21")).toBe("normal"); // 11 días
  });
});

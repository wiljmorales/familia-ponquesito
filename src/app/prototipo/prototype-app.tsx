"use client";

import { useEffect, useReducer, useRef } from "react";
import OrderDetail from "@/components/prototype/OrderDetail";
import OrdersDashboard from "@/components/prototype/OrdersDashboard";
import PrototypeIntro from "@/components/prototype/PrototypeIntro";
import PrototypeShell from "@/components/prototype/PrototypeShell";
import QuoteConfirmation from "@/components/prototype/QuoteConfirmation";
import QuoteForm from "@/components/prototype/QuoteForm";
import {
  createInitialState,
  prototypeReducer,
  recoverScreen,
  selectedOrder,
} from "@/lib/prototype/reducer";
import {
  clearPrototypeStorage,
  diffStatusOverrides,
  loadStatusOverrides,
  saveStatusOverrides,
} from "@/lib/prototype/storage";

export default function PrototypeApp({ baseDate }: { baseDate: string }) {
  const [state, dispatch] = useReducer(prototypeReducer, baseDate, createInitialState);

  // Rehidratación: los cambios guardados se aplican DESPUÉS del montaje con
  // una acción explícita, nunca en el primer render, para que el HTML del
  // servidor y la hidratación del cliente coincidan siempre. Si no hay nada
  // guardado (o está corrupto) loadStatusOverrides devuelve null y no pasa
  // nada: la portada se muestra normal.
  useEffect(() => {
    const overrides = loadStatusOverrides(window.sessionStorage);
    if (overrides && Object.keys(overrides).length > 0) {
      dispatch({ type: "apply_overrides", overrides });
    }
  }, []);

  // Persistencia: el reducer solo crea un array nuevo de pedidos cuando un
  // estado cambia de verdad, así que [state.orders] equivale a "cambiaron
  // los estados" y no se escribe en cada render. El primer disparo se salta
  // para no tocar el storage antes de haberlo leído.
  const skipFirstPersist = useRef(true);
  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    saveStatusOverrides(window.sessionStorage, diffStatusOverrides(baseDate, state.orders));
  }, [baseDate, state.orders]);

  function handleReset() {
    const confirmed = window.confirm(
      "Se restaurarán todos los pedidos y contadores de la demostración. ¿Reiniciar la demo?",
    );
    if (!confirmed) return;
    clearPrototypeStorage(window.sessionStorage);
    dispatch({ type: "reset" });
  }

  const order = selectedOrder(state);
  // Pantalla segura: ante cualquier estado inconsistente (pedido
  // inexistente, confirmación sin cotización) se renderiza el dashboard.
  const screen = recoverScreen(state);

  return (
    <PrototypeShell
      screen={screen}
      onBackToDashboard={() => dispatch({ type: "back_to_dashboard" })}
      onReset={handleReset}
    >
      {screen === "intro" && (
        <PrototypeIntro onExplore={() => dispatch({ type: "enter_dashboard" })} />
      )}

      {screen === "dashboard" && (
        <OrdersDashboard
          orders={state.orders}
          statusFilter={state.statusFilter}
          baseDate={baseDate}
          onFilterChange={(filter) => dispatch({ type: "set_filter", filter })}
          onViewOrder={(orderId) => dispatch({ type: "view_order", orderId })}
        />
      )}

      {screen === "request-detail" && order && (
        <OrderDetail
          order={order}
          baseDate={baseDate}
          onPrepareQuote={() => dispatch({ type: "start_quote" })}
        />
      )}

      {screen === "quote-form" && order && (
        <QuoteForm
          order={order}
          baseDate={baseDate}
          onCancel={() => dispatch({ type: "cancel_quote" })}
          onSend={(input) => dispatch({ type: "send_quote", input })}
        />
      )}

      {screen === "quote-sent" && order && state.sentQuote && (
        <QuoteConfirmation
          order={order}
          sentQuote={state.sentQuote}
          onBackToDashboard={() => dispatch({ type: "back_to_dashboard" })}
        />
      )}
    </PrototypeShell>
  );
}

"use client";

import { useEffect, useReducer, useRef } from "react";
import OrdersDashboard from "@/components/prototype/OrdersDashboard";
import PrototypeIntro from "@/components/prototype/PrototypeIntro";
import PrototypeShell from "@/components/prototype/PrototypeShell";
import StatusBadge from "@/components/prototype/StatusBadge";
import {
  createInitialState,
  prototypeReducer,
  selectedOrder,
} from "@/lib/prototype/reducer";
import {
  clearPrototypeStorage,
  diffStatusOverrides,
  loadStatusOverrides,
  saveStatusOverrides,
} from "@/lib/prototype/storage";
import type { PrototypeOrder } from "@/types/prototype";

/**
 * Vista temporal del detalle mientras llega la Etapa 3: mantiene el
 * contrato de navegación (ver pedido → detalle → volver) sin dejar la
 * pantalla en blanco. Se reemplaza por OrderDetail.
 */
function OrderDetailPlaceholder({
  order,
  onBack,
}: {
  order: PrototypeOrder;
  onBack: () => void;
}) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 rounded-2xl border border-border-soft bg-cream-light p-6">
      <StatusBadge status={order.status} />
      <h1 className="font-serif text-2xl text-cocoa">{order.customerName}</h1>
      <p className="text-sm text-text-secondary">
        {order.celebrationType} · {order.flavor} · {order.guestCount} invitados
      </p>
      <p className="text-sm leading-relaxed text-cocoa">{order.cakeDescription}</p>
      <p className="rounded-xl bg-gold/10 px-4 py-3 text-sm text-cocoa">
        La ficha completa del pedido (con línea de progreso y cotización) llega en la
        siguiente etapa del prototipo.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-full border border-terracotta px-4 py-1.5 text-sm font-medium text-terracotta-dark transition-colors hover:bg-terracotta/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
      >
        Volver al centro de pedidos
      </button>
    </section>
  );
}

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

  return (
    <PrototypeShell
      screen={state.screen}
      onBackToDashboard={() => dispatch({ type: "back_to_dashboard" })}
      onReset={handleReset}
    >
      {state.screen === "intro" && (
        <PrototypeIntro onExplore={() => dispatch({ type: "enter_dashboard" })} />
      )}

      {state.screen === "dashboard" && (
        <OrdersDashboard
          orders={state.orders}
          statusFilter={state.statusFilter}
          baseDate={baseDate}
          onFilterChange={(filter) => dispatch({ type: "set_filter", filter })}
          onViewOrder={(orderId) => dispatch({ type: "view_order", orderId })}
        />
      )}

      {state.screen !== "intro" && state.screen !== "dashboard" && (
        // request-detail (y, hasta la Etapa 3, cualquier pantalla aún no
        // construida) muestra la vista temporal; nunca una página en blanco.
        <OrderDetailPlaceholder
          order={order ?? state.orders[0]}
          onBack={() => dispatch({ type: "back_to_dashboard" })}
        />
      )}
    </PrototypeShell>
  );
}

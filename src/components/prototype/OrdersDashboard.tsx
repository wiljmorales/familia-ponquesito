"use client";

import { CakeIcon } from "@/components/ui/icons";
import { dashboardIndicators, filterOrders } from "@/lib/prototype/reducer";
import type { PrototypeOrder, StatusFilter } from "@/types/prototype";
import OrderCard from "./OrderCard";
import OrderFilters from "./OrderFilters";
import { STATUS_FILTER_LABEL } from "./StatusBadge";

interface OrdersDashboardProps {
  orders: PrototypeOrder[];
  statusFilter: StatusFilter;
  /** "YYYY-MM-DD": fecha base de la demo, viene del servidor. */
  baseDate: string;
  onFilterChange: (filter: StatusFilter) => void;
  onViewOrder: (orderId: string) => void;
}

export default function OrdersDashboard({
  orders,
  statusFilter,
  baseDate,
  onFilterChange,
  onViewOrder,
}: OrdersDashboardProps) {
  const indicators = dashboardIndicators(orders, baseDate);
  const visibleOrders = filterOrders(orders, statusFilter);

  const tiles = [
    { label: "Solicitudes nuevas", value: indicators.newCount },
    { label: "Por cotizar", value: indicators.toQuoteCount },
    { label: "Esperando anticipo", value: indicators.waitingDepositCount },
    { label: "Entregas en 7 días", value: indicators.upcomingDeliveries },
  ];

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl text-cocoa sm:text-3xl">Centro de pedidos</h1>
        <p className="mt-1 text-sm text-text-secondary sm:text-base">
          Las solicitudes de tortas de todos los canales, organizadas en un solo lugar.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <li
            key={tile.label}
            className="rounded-2xl border border-border-soft bg-cream-light p-4"
          >
            <p className="font-serif text-3xl text-cocoa tabular-nums">{tile.value}</p>
            <p className="mt-0.5 text-xs text-text-secondary sm:text-sm">{tile.label}</p>
          </li>
        ))}
      </ul>

      <OrderFilters orders={orders} active={statusFilter} onChange={onFilterChange} />

      {visibleOrders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-soft bg-cream-light/60 px-6 py-12 text-center">
          <CakeIcon aria-hidden className="size-10 text-terracotta/40" />
          <p className="text-sm text-text-secondary">
            {statusFilter === "all"
              ? "No hay pedidos en la demostración."
              : `Ahora mismo no hay pedidos en «${STATUS_FILTER_LABEL[statusFilter]}».`}
          </p>
          <button
            type="button"
            onClick={() => onFilterChange("all")}
            className="rounded-full border border-terracotta px-4 py-1.5 text-sm font-medium text-terracotta-dark transition-colors hover:bg-terracotta/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
          >
            Ver todos los pedidos
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleOrders.map((order) => (
            <OrderCard key={order.id} order={order} baseDate={baseDate} onView={onViewOrder} />
          ))}
        </div>
      )}
    </section>
  );
}

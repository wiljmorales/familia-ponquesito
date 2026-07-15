"use client";

import { countByStatus } from "@/lib/prototype/reducer";
import {
  ORDER_STATUSES,
  type PrototypeOrder,
  type StatusFilter,
} from "@/types/prototype";
import { STATUS_FILTER_LABEL } from "./StatusBadge";

interface OrderFiltersProps {
  orders: PrototypeOrder[];
  active: StatusFilter;
  onChange: (filter: StatusFilter) => void;
}

export default function OrderFilters({ orders, active, onChange }: OrderFiltersProps) {
  const counts = countByStatus(orders);
  const options: { value: StatusFilter; label: string; count: number }[] = [
    { value: "all", label: "Todos", count: orders.length },
    ...ORDER_STATUSES.map((status) => ({
      value: status as StatusFilter,
      label: STATUS_FILTER_LABEL[status],
      count: counts[status],
    })),
  ];

  return (
    // En móvil los filtros se desplazan en horizontal (el -mx compensa el
    // padding del main para que el scroll llegue al borde de la pantalla).
    <div
      role="group"
      aria-label="Filtrar pedidos por estado"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {options.map((option) => {
        const isActive = active === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark ${
              isActive
                ? "border-terracotta-dark bg-terracotta-dark font-medium text-cream-light"
                : "border-border-soft bg-cream-light text-cocoa hover:border-terracotta/50"
            }`}
          >
            {option.label}
            <span
              className={`rounded-full px-1.5 text-xs tabular-nums ${
                isActive ? "bg-cream-light/25" : "bg-cocoa/5 text-text-secondary"
              }`}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

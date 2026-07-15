import type { OrderStatus } from "@/types/prototype";

/** Labels en singular (badge del pedido, línea de progreso). */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Nueva",
  reviewing: "En revisión",
  to_quote: "Por cotizar",
  waiting_deposit: "Esperando anticipo",
  confirmed: "Confirmada",
};

/** Labels en plural para los filtros del dashboard. */
export const STATUS_FILTER_LABEL: Record<OrderStatus, string> = {
  new: "Nuevas",
  reviewing: "Por revisar",
  to_quote: "Por cotizar",
  waiting_deposit: "Esperando anticipo",
  confirmed: "Confirmadas",
};

/**
 * Cada estado con un tinte distinto de la paleta de la marca (nada de
 * colores fríos corporativos); texto cacao sobre fondos claros para
 * mantener contraste. "Confirmada" va en sólido: es el estado final.
 */
const STATUS_CLASSES: Record<OrderStatus, string> = {
  new: "border-terracotta/30 bg-terracotta/10 text-terracotta-dark",
  reviewing: "border-yellow/60 bg-yellow/20 text-cocoa",
  to_quote: "border-gold/60 bg-gold/15 text-cocoa",
  waiting_deposit: "border-blush/70 bg-blush/25 text-cocoa",
  confirmed: "border-cocoa bg-cocoa text-cream-light",
};

export default function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

"use client";

import { Sparkles } from "lucide-react";
import { CakeIcon, ClockIcon, DeliveryIcon, PeopleIcon } from "@/components/ui/icons";
import { formatDateEs } from "@/email/format-date";
import { daysBetweenISO } from "@/lib/prototype/dates";
import { orderAttention } from "@/lib/prototype/reducer";
import type { OrderAttention, PrototypeOrder } from "@/types/prototype";
import StatusBadge from "./StatusBadge";

const ATTENTION_LABEL: Record<OrderAttention, string> = {
  urgent: "Atender hoy",
  high: "Atender pronto",
  normal: "Con margen",
};

const ATTENTION_CLASSES: Record<OrderAttention, string> = {
  urgent: "font-semibold text-terracotta-dark",
  high: "font-medium text-cocoa",
  normal: "text-text-secondary",
};

interface OrderCardProps {
  order: PrototypeOrder;
  /** "YYYY-MM-DD": para derivar días restantes y nivel de atención. */
  baseDate: string;
  onView: (orderId: string) => void;
}

export default function OrderCard({ order, baseDate, onView }: OrderCardProps) {
  const daysUntil = daysBetweenISO(baseDate, order.celebrationDate);
  const attention = orderAttention(baseDate, order.celebrationDate);
  // El recorrido sugerido solo se destaca mientras el pedido sigue nuevo:
  // tras cotizarlo (o al filtrar) vuelve a ser una tarjeta más.
  const isSuggested = order.isDemoFlowOrder && order.status === "new";

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border bg-cream-light p-5 transition-colors ${
        isSuggested ? "border-gold shadow-sm" : "border-border-soft hover:border-terracotta/40"
      }`}
    >
      {isSuggested && (
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-gold">
          <Sparkles aria-hidden className="size-3.5" />
          Recorrido sugerido
        </p>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-lg text-cocoa">{order.customerName}</h3>
          <p className="text-sm text-text-secondary">
            {order.celebrationType} · {order.id}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <ul className="flex flex-col gap-1.5 text-sm text-cocoa">
        <li className="flex items-center gap-2">
          <ClockIcon aria-hidden className="size-4 shrink-0 text-terracotta" />
          <span>
            {formatDateEs(order.celebrationDate)}{" "}
            <span className="text-text-secondary">(en {daysUntil} días)</span>
          </span>
        </li>
        <li className="flex items-center gap-2">
          <CakeIcon aria-hidden className="size-4 shrink-0 text-terracotta" />
          <span>{order.flavor}</span>
          <PeopleIcon aria-hidden className="ml-2 size-4 shrink-0 text-terracotta" />
          <span>{order.guestCount} invitados</span>
        </li>
        <li className="flex items-center gap-2">
          <DeliveryIcon aria-hidden className="size-4 shrink-0 text-terracotta" />
          <span>
            {order.deliveryMethod === "delivery" ? `Delivery · ${order.zone}` : "Retiro en persona"}
          </span>
        </li>
      </ul>

      <p className="line-clamp-2 text-sm leading-relaxed text-text-secondary">
        {order.cakeDescription}
      </p>

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className={`text-xs ${ATTENTION_CLASSES[attention]}`}>
          {ATTENTION_LABEL[attention]}
        </span>
        <button
          type="button"
          onClick={() => onView(order.id)}
          className="rounded-full border border-terracotta px-4 py-1.5 text-sm font-medium text-terracotta-dark transition-colors hover:bg-terracotta/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
        >
          Ver pedido
        </button>
      </div>
    </article>
  );
}

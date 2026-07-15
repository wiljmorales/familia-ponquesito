"use client";

import { Check, Sparkles } from "lucide-react";
import { CakeIcon, ClockIcon, DeliveryIcon, PeopleIcon } from "@/components/ui/icons";
import { formatDateEs } from "@/email/format-date";
import { daysBetweenISO } from "@/lib/prototype/dates";
import { orderAttention } from "@/lib/prototype/reducer";
import type { PrototypeOrder } from "@/types/prototype";
import PrototypeButton from "./PrototypeButton";
import StatusBadge, { AttentionTag } from "./StatusBadge";

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
  // tras cotizarlo vuelve a ser una tarjeta más, con una marca discreta de
  // que fue el pedido procesado en la demo (derivada, sin estado extra).
  const isSuggested = order.isDemoFlowOrder && order.status === "new";
  const wasProcessedInDemo = order.isDemoFlowOrder && order.status === "waiting_deposit";

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
      {wasProcessedInDemo && (
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Check aria-hidden className="size-3.5 text-terracotta" />
          Cotizada en esta demostración
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
        <AttentionTag attention={attention} />
        <PrototypeButton variant="outline" size="sm" onClick={() => onView(order.id)}>
          Ver pedido
        </PrototypeButton>
      </div>
    </article>
  );
}

"use client";

import type { ReactNode } from "react";
import { CakeIcon } from "@/components/ui/icons";
import { formatDateEs } from "@/email/format-date";
import { daysBetweenISO } from "@/lib/prototype/dates";
import { canPrepareQuote, orderAttention } from "@/lib/prototype/reducer";
import type { PrototypeOrder } from "@/types/prototype";
import FocusHeading from "./FocusHeading";
import OrderProgress from "./OrderProgress";
import PrototypeButton from "./PrototypeButton";
import StatusBadge, { AttentionTag } from "./StatusBadge";

interface OrderDetailProps {
  order: PrototypeOrder;
  /** "YYYY-MM-DD": para derivar días disponibles y nivel de atención. */
  baseDate: string;
  onPrepareQuote: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </dt>
      <dd className="text-sm text-cocoa">{children}</dd>
    </div>
  );
}

/** Nota que reemplaza al CTA cuando cotizar ya no aplica. */
const STATUS_NOTE: Partial<Record<PrototypeOrder["status"], string>> = {
  waiting_deposit:
    "La cotización ya fue enviada: este pedido espera el anticipo del cliente para reservarse.",
  confirmed: "Pedido confirmado: el anticipo fue recibido y entra en producción.",
};

export default function OrderDetail({ order, baseDate, onPrepareQuote }: OrderDetailProps) {
  const daysAvailable = daysBetweenISO(baseDate, order.celebrationDate);
  const attention = orderAttention(baseDate, order.celebrationDate);
  const statusNote = STATUS_NOTE[order.status];

  return (
    <article className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-border-soft bg-cream-light p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-text-secondary">
              {order.id} · Datos de demostración
            </p>
            <FocusHeading className="mt-1 font-serif text-2xl text-cocoa sm:text-3xl">
              {order.customerName}
            </FocusHeading>
            <p className="mt-1 text-sm text-text-secondary">
              {order.celebrationType} · solicitud recibida el {formatDateEs(order.receivedDate)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <StatusBadge status={order.status} />
            <AttentionTag attention={attention} />
          </div>
        </div>
        <OrderProgress status={order.status} />
      </header>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section
          aria-label="Datos de la solicitud"
          className="flex flex-col gap-5 rounded-2xl border border-border-soft bg-cream-light p-5 sm:p-6"
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Contacto">
              {order.whatsapp}{" "}
              <span className="text-xs text-text-secondary">(contacto de demostración)</span>
            </Field>
            <Field label="Fecha de celebración">
              {formatDateEs(order.celebrationDate)}
            </Field>
            <Field label="Días disponibles">
              {daysAvailable} días antes de la entrega
            </Field>
            <Field label="Invitados">{order.guestCount} personas</Field>
            <Field label="Sabor preferido">{order.flavor}</Field>
            <Field label="Entrega">
              {order.deliveryMethod === "delivery"
                ? `Delivery (app Vamos, costo adicional) · ${order.zone}`
                : "Retiro en persona"}
            </Field>
          </dl>
          <div className="flex flex-col gap-1 border-t border-border-soft pt-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Descripción de la torta
            </h2>
            <p className="text-sm leading-relaxed text-cocoa">{order.cakeDescription}</p>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section
            aria-label="Referencia visual"
            className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-cream-light p-5"
          >
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Referencia visual
            </h2>
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-soft px-4 py-6 text-center">
              <CakeIcon aria-hidden className="size-8 text-terracotta/40" />
              <p className="text-sm text-text-secondary">{order.visualReference}</p>
            </div>
          </section>
          <section
            aria-label="Notas"
            className="flex flex-col gap-2 rounded-2xl border border-border-soft bg-cream-light p-5"
          >
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Notas
            </h2>
            <p className="text-sm leading-relaxed text-cocoa">{order.notes}</p>
          </section>
        </aside>
      </div>

      <footer className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-cream-light p-5 sm:p-6">
        {canPrepareQuote(order.status) ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <PrototypeButton onClick={onPrepareQuote}>Preparar cotización</PrototypeButton>
              {/* Acciones futuras: dan contexto de producto, sin flujo en esta demo. */}
              <PrototypeButton variant="outline" size="sm" disabled>
                Solicitar información
              </PrototypeButton>
              <PrototypeButton variant="outline" size="sm" disabled>
                No puedo tomar este pedido
              </PrototypeButton>
            </div>
            <p className="text-xs text-text-secondary">
              Las acciones secundarias son parte de la visión del producto y no tienen flujo en
              esta demostración.
            </p>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-cocoa">{statusNote}</p>
        )}
      </footer>
    </article>
  );
}

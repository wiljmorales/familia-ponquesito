"use client";

import { Check } from "lucide-react";
import { DEPOSIT_PERCENT } from "@/lib/constants/business";
import { formatDateEs } from "@/email/format-date";
import { formatMoney } from "@/lib/prototype/quote";
import type { PrototypeOrder, SentQuote } from "@/types/prototype";
import FocusHeading from "./FocusHeading";
import PrototypeButton from "./PrototypeButton";
import QuotePreview from "./QuotePreview";
import StatusBadge from "./StatusBadge";

interface QuoteConfirmationProps {
  order: PrototypeOrder;
  sentQuote: SentQuote;
  onBackToDashboard: () => void;
}

export default function QuoteConfirmation({
  order,
  sentQuote,
  onBackToDashboard,
}: QuoteConfirmationProps) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-6">
      {/* role="status": el lector de pantalla anuncia la confirmación. */}
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
          <Check aria-hidden className="size-7" />
        </span>
        <FocusHeading className="font-serif text-2xl text-cocoa sm:text-3xl">
          Cotización simulada enviada
        </FocusHeading>
        <p className="max-w-md text-sm leading-relaxed text-text-secondary">
          No se envió ningún mensaje real. Así quedaría el pedido dentro de la herramienta
          después de cotizar.
        </p>
      </div>

      <div className="flex w-full flex-col gap-4 rounded-2xl border border-border-soft bg-cream-light p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-text-secondary">
              {order.id} · Datos de demostración
            </p>
            <p className="mt-0.5 font-serif text-lg text-cocoa">{order.customerName}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Nuevo estado:</span>
            <StatusBadge status={order.status} />
          </div>
        </div>

        <dl className="grid gap-3 border-t border-border-soft pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-secondary">Total cotizado</dt>
            <dd className="text-lg font-medium text-cocoa tabular-nums">
              {formatMoney(sentQuote.total)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-secondary">Anticipo ({DEPOSIT_PERCENT} %)</dt>
            <dd className="text-lg font-medium text-terracotta-dark tabular-nums">
              {formatMoney(sentQuote.deposit)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-secondary">Fecha límite</dt>
            <dd className="text-sm text-cocoa">{formatDateEs(sentQuote.confirmDeadline)}</dd>
          </div>
        </dl>
        <p className="text-xs text-text-secondary">Montos en US$ de demostración.</p>
      </div>

      <div className="w-full">
        <QuotePreview message={sentQuote.message} />
      </div>

      <PrototypeButton onClick={onBackToDashboard}>Volver al centro de pedidos</PrototypeButton>
    </section>
  );
}

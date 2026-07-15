"use client";

import { useState, type FormEvent } from "react";
import InputField from "@/components/ui/InputField";
import TextareaField from "@/components/ui/TextareaField";
import { DEPOSIT_PERCENT, MIN_LEAD_DAYS } from "@/lib/constants/business";
import { formatDateEs } from "@/email/format-date";
import {
  buildCustomerMessage,
  computeQuoteTotals,
  defaultQuoteFormValues,
  formatMoney,
  isPreviewableQuote,
  latestConfirmDeadline,
  quoteInputFromForm,
  validateQuote,
  type QuoteFormValues,
} from "@/lib/prototype/quote";
import type { PrototypeOrder, QuoteInput } from "@/types/prototype";
import FocusHeading from "./FocusHeading";
import PrototypeButton from "./PrototypeButton";
import QuotePreview from "./QuotePreview";

interface QuoteFormProps {
  order: PrototypeOrder;
  /** "YYYY-MM-DD": fecha base de la demo (valida la fecha límite). */
  baseDate: string;
  onCancel: () => void;
  onSend: (input: QuoteInput) => void;
}

/** Monto para mostrar: "—" mientras el campo del que depende esté vacío. */
function displayMoney(value: number): string {
  return Number.isFinite(value) ? formatMoney(value) : "—";
}

export default function QuoteForm({ order, baseDate, onCancel, onSend }: QuoteFormProps) {
  // El estado vive solo en este componente: cancelar descarta los valores
  // y volver a "Preparar cotización" arranca de los iniciales (decisión
  // documentada en docs/challenge-5.md).
  const [values, setValues] = useState<QuoteFormValues>(() =>
    defaultQuoteFormValues(order, baseDate),
  );
  // Los errores se muestran a partir del primer intento de envío y se
  // actualizan en vivo desde entonces.
  const [submitted, setSubmitted] = useState(false);

  const input = quoteInputFromForm(values);
  const context = { baseDate, celebrationDate: order.celebrationDate };
  const errors = validateQuote(input, context);
  const hasErrors = Object.keys(errors).length > 0;
  const totals = computeQuoteTotals(input);

  function update<Field extends keyof QuoteFormValues>(
    field: Field,
    value: QuoteFormValues[Field],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    // El reducer vuelve a validar (segunda barrera) antes de avanzar.
    onSend(input);
  }

  const fieldError = (field: keyof typeof errors) => (submitted ? errors[field] : undefined);

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <FocusHeading className="font-serif text-2xl text-cocoa sm:text-3xl">
          Preparar cotización
        </FocusHeading>
        <p className="text-sm text-text-secondary">
          {order.id} · {order.customerName} · {order.flavor.toLowerCase()} para el{" "}
          {formatDateEs(order.celebrationDate)}
        </p>
        <p className="text-xs text-text-secondary">
          Montos en US$ de demostración: no son precios reales de Familia Ponquesito.
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section
          aria-label="Montos y condiciones"
          className="flex flex-col gap-4 rounded-2xl border border-border-soft bg-cream-light p-5 sm:p-6"
        >
          <InputField
            label="Precio base (US$ demo)"
            name="basePrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            value={values.basePrice}
            onChange={(event) => update("basePrice", event.target.value)}
            error={fieldError("basePrice")}
          />
          <InputField
            label="Decoración o personalización (US$ demo)"
            name="decorationPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={values.decorationPrice}
            onChange={(event) => update("decorationPrice", event.target.value)}
            error={fieldError("decorationPrice")}
            hint="Opcional: déjalo vacío si no aplica."
          />

          <div className="flex flex-col gap-3 rounded-xl border border-border-soft p-4">
            <label className="flex items-center gap-2.5 text-sm font-medium text-cocoa">
              <input
                type="checkbox"
                checked={values.deliveryEnabled}
                onChange={(event) => update("deliveryEnabled", event.target.checked)}
                className="size-4 accent-terracotta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta-dark focus-visible:ring-offset-2"
              />
              Incluir delivery (app Vamos, costo adicional)
            </label>
            {values.deliveryEnabled ? (
              <InputField
                label="Costo del delivery (US$ demo)"
                name="deliveryPrice"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={values.deliveryPrice}
                onChange={(event) => update("deliveryPrice", event.target.value)}
                error={fieldError("deliveryPrice")}
              />
            ) : (
              <p className="text-xs text-text-secondary">
                Delivery desactivado: no se suma al total. El monto se conserva por si lo
                reactivas.
              </p>
            )}
          </div>

          <InputField
            label="Descuento (US$ demo)"
            name="discount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={values.discount}
            onChange={(event) => update("discount", event.target.value)}
            error={fieldError("discount")}
            hint="Opcional: no puede igualar o superar el total."
          />
          <InputField
            label="Fecha límite para confirmar"
            name="confirmDeadline"
            type="date"
            required
            min={baseDate}
            max={latestConfirmDeadline(order.celebrationDate)}
            value={values.confirmDeadline}
            onChange={(event) => update("confirmDeadline", event.target.value)}
            error={fieldError("confirmDeadline")}
            hint={`A más tardar ${MIN_LEAD_DAYS} días antes de la celebración (anticipación mínima del negocio).`}
          />
          <TextareaField
            label="Mensaje adicional para el cliente"
            name="personalNote"
            rows={3}
            value={values.personalNote}
            onChange={(event) => update("personalNote", event.target.value)}
            hint="Opcional: se añade al final del mensaje generado."
          />
        </section>

        <div className="flex flex-col gap-4">
          <section
            aria-label="Totales de la cotización"
            aria-live="polite"
            className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-cream-light p-5 sm:p-6"
          >
            <dl className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-text-secondary">Total cotizado</dt>
                <dd className="font-serif text-3xl text-cocoa tabular-nums">
                  {displayMoney(totals.total)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border-soft pt-2">
                <dt className="text-sm text-text-secondary">
                  Anticipo para reservar ({DEPOSIT_PERCENT} %)
                </dt>
                <dd className="text-lg font-medium text-terracotta-dark tabular-nums">
                  {displayMoney(totals.deposit)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-text-secondary">
              El anticipo se calcula solo, con el {DEPOSIT_PERCENT} % real del negocio. Montos
              en US$ de demostración.
            </p>
          </section>

          {isPreviewableQuote(input) ? (
            <QuotePreview message={buildCustomerMessage(order, input)} />
          ) : (
            <p className="rounded-2xl border border-dashed border-border-soft px-4 py-6 text-center text-sm text-text-secondary">
              Completa el precio base y la fecha límite para generar la vista previa del
              mensaje al cliente.
            </p>
          )}
        </div>
      </div>

      <footer className="flex flex-col gap-2">
        {submitted && hasErrors && (
          <p role="alert" className="text-sm font-medium text-red-600">
            Revisa los campos marcados: la cotización todavía no es válida.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <PrototypeButton type="submit">Enviar cotización simulada</PrototypeButton>
          <PrototypeButton type="button" variant="outline" onClick={onCancel}>
            Volver al detalle
          </PrototypeButton>
        </div>
        <p className="text-xs text-text-secondary">
          Simulación: no se envía ningún mensaje, correo ni WhatsApp real.
        </p>
      </footer>
    </form>
  );
}

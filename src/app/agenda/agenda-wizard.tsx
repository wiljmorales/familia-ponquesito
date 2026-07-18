"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarHeart, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import SelectField from "@/components/ui/SelectField";
import TextareaField from "@/components/ui/TextareaField";
import AvailabilityCalendar from "./availability-calendar";
import {
  fetchAgendaAvailability,
  submitAgendaReservation,
  type SubmitAgendaReservationResult,
} from "@/lib/actions/agenda";
import {
  agendaContactSchema,
  agendaOrderSchema,
  type AgendaContactValues,
  type AgendaOrderValues,
} from "@/lib/validations/agenda-reservation";
import { classifyOrder, HUMAN_REVIEW_DATE_NOTICE } from "@/reservations/classify-order";
import { addDaysISO, businessTodayISO } from "@/lib/business-dates";
import { BOOKING_WINDOW_DAYS } from "@/reservations/capacity";
import { monthOfISO } from "@/reservations/calendar";
import { findNearbyAlternatives } from "@/reservations/availability";
import type { DayAvailability } from "@/reservations/types";
import { formatDateEs } from "@/email/format-date";
import {
  BUSINESS_NAME,
  DEPOSIT_PERCENT,
  FORM_FLAVOR_OPTIONS,
  MAX_GUEST_COUNT,
  MIN_LEAD_DAYS,
  SLOGAN,
} from "@/lib/constants/business";

/**
 * Wizard público de Agenda Ponquesito (Reto 8, Etapa 3): cuatro pasos —
 * Tu torta, La fecha, Tus datos, Confirmación. La clasificación que se
 * muestra aquí es solo una vista previa (el mismo classifyOrder
 * determinístico); la decisión real la toma el servidor en cada Server
 * Action, y la base de datos re-valida todo al reservar.
 */

const STEPS = ["Tu torta", "La fecha", "Tus datos", "Confirmación"] as const;

interface OrderFormRaw {
  guestCount: string;
  tiers: string;
  isCustomDesign: string;
  hasReferenceImage: string;
  designDescription: string;
  flavor: string;
  theme: string;
}

const ORDER_DEFAULTS: OrderFormRaw = {
  guestCount: "",
  tiers: "",
  isCustomDesign: "",
  hasReferenceImage: "",
  designDescription: "",
  flavor: "",
  theme: "",
};

interface ContactFormRaw {
  customerName: string;
  email: string;
  phone: string;
  fulfillmentType: string;
  deliveryDetails: string;
  companyWebsite: string;
}

const CONTACT_DEFAULTS: ContactFormRaw = {
  customerName: "",
  email: "",
  phone: "",
  fulfillmentType: "",
  deliveryDetails: "",
  companyWebsite: "",
};

interface Confirmation {
  code: string;
  celebrationDate: string;
  status: "pending_deposit" | "human_review";
}

/**
 * Secuencia de peticiones de disponibilidad, a nivel de módulo (no un ref:
 * el linter de React prohíbe refs alcanzables desde el render). Solo se
 * lee/escribe dentro de la función async; hay un único wizard por página.
 */
let availabilityRequestSeq = 0;

const RADIO_CLASSES =
  "size-4 accent-[var(--terracotta)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark";

function RadioGroup({
  legend,
  error,
  children,
}: {
  legend: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-cocoa">
        {legend}
        <span aria-hidden className="text-terracotta">
          {" "}
          *
        </span>
      </legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">{children}</div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export default function AgendaWizard() {
  const [step, setStep] = useState(0);

  // Paso 1 — Tu torta.
  const orderForm = useForm<OrderFormRaw, unknown, AgendaOrderValues>({
    resolver: zodResolver(agendaOrderSchema),
    defaultValues: ORDER_DEFAULTS,
  });
  const [orderRaw, setOrderRaw] = useState<OrderFormRaw | null>(null);

  // Vista previa de la clasificación (mismo código determinístico que usa
  // el servidor; el servidor la recalcula siempre).
  const previewHumanReview = useMemo(() => {
    if (!orderRaw) return false;
    return (
      classifyOrder({
        guestCount: Number(orderRaw.guestCount),
        tiers: orderRaw.tiers === "two_or_more" ? "two_or_more" : "one",
        isCustomDesign: orderRaw.isCustomDesign === "yes",
        hasReferenceImage: orderRaw.hasReferenceImage === "yes",
        designDescription: orderRaw.designDescription,
      }).kind === "human_required"
    );
  }, [orderRaw]);

  // Paso 2 — La fecha.
  const todayISO = useMemo(() => businessTodayISO(), []);
  const minMonthISO = monthOfISO(todayISO);
  const maxMonthISO = monthOfISO(addDaysISO(todayISO, BOOKING_WINDOW_DAYS));
  const [monthISO, setMonthISO] = useState(() =>
    monthOfISO(addDaysISO(todayISO, MIN_LEAD_DAYS)),
  );
  const [daysByDate, setDaysByDate] = useState<Record<string, DayAvailability>>({});
  const [loadingDays, setLoadingDays] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [humanReview, setHumanReview] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [nearbyForDate, setNearbyForDate] = useState<{
    date: string;
    options: DayAvailability[];
  } | null>(null);

  // Carga explícita (sin useEffect): se invoca al entrar al paso 2, al
  // cambiar de mes y al reintentar, siempre contra el backend. requestId
  // descarta respuestas viejas si el cliente cambió de mes en el aire.
  const loadAvailability = useCallback(async (order: OrderFormRaw, month: string) => {
    const requestId = ++availabilityRequestSeq;
    setLoadingDays(true);
    setAvailabilityError(null);
    try {
      const result = await fetchAgendaAvailability(order, month);
      if (requestId !== availabilityRequestSeq) return;
      if (result.ok) {
        setDaysByDate(Object.fromEntries(result.days.map((day) => [day.date, day])));
        setHumanReview(result.humanReview);
      } else {
        setAvailabilityError(result.message);
      }
    } catch {
      if (requestId === availabilityRequestSeq) {
        setAvailabilityError(
          "No pudimos consultar la agenda en este momento. Inténtalo de nuevo en unos minutos.",
        );
      }
    } finally {
      if (requestId === availabilityRequestSeq) setLoadingDays(false);
    }
  }, []);

  // Paso 3 — Tus datos.
  const contactForm = useForm<ContactFormRaw, unknown, AgendaContactValues>({
    resolver: zodResolver(agendaContactSchema),
    defaultValues: CONTACT_DEFAULTS,
  });
  const fulfillmentType = useWatch({
    control: contactForm.control,
    name: "fulfillmentType",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Extract<
    SubmitAgendaReservationResult,
    { ok: false }
  > | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const flavorLabel = useMemo(() => {
    const value = orderRaw?.flavor;
    return FORM_FLAVOR_OPTIONS.find((option) => option.value === value)?.label ?? value;
  }, [orderRaw]);

  function handleOrderSubmit() {
    const values = orderForm.getValues();
    setOrderRaw(values);
    setStep(1);
    void loadAvailability(values, monthISO);
  }

  function handleSelectDay(day: DayAvailability) {
    setSelectedDate(day.date);
    setNearbyForDate(null);
  }

  function handleSelectUnavailable(day: DayAvailability) {
    // Alternativas desde los datos recién consultados de este mes.
    const options = findNearbyAlternatives(Object.values(daysByDate), day.date);
    setNearbyForDate({ date: day.date, options });
  }

  const applyAlternative = useCallback(
    (date: string) => {
      setSelectedDate(date);
      setNearbyForDate(null);
      setSubmitError(null);
      const month = monthOfISO(date);
      setMonthISO(month);
      if (orderRaw) void loadAvailability(orderRaw, month);
    },
    [orderRaw, loadAvailability],
  );

  const applyConflictAlternative = useCallback(
    (date: string) => {
      setSelectedDate(date);
      setNearbyForDate(null);
      setSubmitError(null);
      const month = monthOfISO(date);
      setMonthISO(month);
      // Una fecha distinta nunca se confirma silenciosamente desde el paso
      // de datos: el cliente vuelve al calendario y debe pulsar Continuar.
      setStep(1);
      if (orderRaw) void loadAvailability(orderRaw, month);
    },
    [orderRaw, loadAvailability],
  );

  async function handleContactSubmit() {
    if (submitting || !orderRaw || !selectedDate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const contact = contactForm.getValues();
      const result = await submitAgendaReservation({
        ...orderRaw,
        ...contact,
        celebrationDate: selectedDate,
      });
      if (result.ok) {
        setConfirmation({
          code: result.code,
          celebrationDate: result.celebrationDate,
          status: result.status,
        });
        setStep(3);
      } else {
        setSubmitError(result);
        if (result.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            if (field in CONTACT_DEFAULTS) {
              contactForm.setError(field as keyof ContactFormRaw, { message });
            }
          }
        }
      }
    } catch {
      setSubmitError({
        ok: false,
        message:
          "No pudimos enviar tu solicitud en este momento. Inténtalo de nuevo en unos minutos.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedDay = selectedDate ? daysByDate[selectedDate] : undefined;
  const hasSelectableDays = Object.values(daysByDate).some((day) => day.canAccept);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <Link href="/" className="font-script text-3xl text-terracotta">
          {BUSINESS_NAME}
        </Link>
        <h1 className="font-serif text-3xl leading-tight text-cocoa sm:text-4xl">
          Agenda tu torta
        </h1>
        <p className="text-sm text-text-secondary">{SLOGAN}</p>
      </header>

      {/* Indicador de progreso: 1 Tu torta · 2 La fecha · 3 Tus datos · 4 Confirmación */}
      <ol className="flex items-center justify-center gap-2 sm:gap-3" aria-label="Progreso">
        {STEPS.map((label, index) => {
          const isCurrent = index === step;
          const isDone = index < step;
          return (
            <li key={label} className="flex items-center gap-2 sm:gap-3">
              {index > 0 && <span aria-hidden className="h-px w-4 bg-border-soft sm:w-8" />}
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-1.5 text-xs sm:text-sm ${
                  isCurrent ? "font-semibold text-terracotta" : isDone ? "text-cocoa" : "text-text-secondary/70"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex size-6 items-center justify-center rounded-full border text-[11px] ${
                    isCurrent
                      ? "border-terracotta bg-terracotta text-cream-light"
                      : isDone
                        ? "border-terracotta text-terracotta"
                        : "border-border-soft text-text-secondary"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <main className="rounded-3xl border border-border-soft bg-cream-light p-5 sm:p-8">
        {step === 0 && (
          <form
            noValidate
            onSubmit={orderForm.handleSubmit(handleOrderSubmit)}
            className="flex flex-col gap-5"
          >
            <div>
              <h2 className="font-serif text-2xl text-cocoa">Cuéntanos de tu torta</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Con estas respuestas sabremos cuánto espacio de horno necesita tu
                pedido y qué fechas podemos ofrecerte.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <InputField
                label="Número aproximado de personas"
                required
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_GUEST_COUNT}
                placeholder="Ej. 20"
                error={orderForm.formState.errors.guestCount?.message}
                {...orderForm.register("guestCount")}
              />
              <SelectField
                label="Sabor preferido"
                required
                placeholder="Selecciona un sabor"
                options={FORM_FLAVOR_OPTIONS}
                error={orderForm.formState.errors.flavor?.message}
                {...orderForm.register("flavor")}
              />
            </div>

            <RadioGroup
              legend="¿Tu torta llevará varios pisos?"
              error={orderForm.formState.errors.tiers?.message}
            >
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="one"
                  className={RADIO_CLASSES}
                  {...orderForm.register("tiers")}
                />
                Un solo piso
              </label>
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="two_or_more"
                  className={RADIO_CLASSES}
                  {...orderForm.register("tiers")}
                />
                Dos o más pisos
              </label>
            </RadioGroup>

            <RadioGroup
              legend="¿Quieres decoración personalizada o temática?"
              error={orderForm.formState.errors.isCustomDesign?.message}
            >
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="yes"
                  className={RADIO_CLASSES}
                  {...orderForm.register("isCustomDesign")}
                />
                Sí, personalizada
              </label>
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="no"
                  className={RADIO_CLASSES}
                  {...orderForm.register("isCustomDesign")}
                />
                No, algo sencillo
              </label>
            </RadioGroup>

            <RadioGroup
              legend="¿Tienes una imagen de referencia del diseño?"
              error={orderForm.formState.errors.hasReferenceImage?.message}
            >
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="yes"
                  className={RADIO_CLASSES}
                  {...orderForm.register("hasReferenceImage")}
                />
                Sí
              </label>
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="no"
                  className={RADIO_CLASSES}
                  {...orderForm.register("hasReferenceImage")}
                />
                No
              </label>
            </RadioGroup>

            <TextareaField
              label="Describe la torta que imaginas"
              required
              placeholder="Estilo, colores, tema de la celebración, dedicatoria…"
              hint="Mínimo 10 caracteres. Si tienes una referencia, podrás compartirla cuando te contactemos."
              error={orderForm.formState.errors.designDescription?.message}
              {...orderForm.register("designDescription")}
            />

            <InputField
              label="Tema de la celebración (opcional)"
              placeholder="Ej. Safari, princesas, fútbol…"
              error={orderForm.formState.errors.theme?.message}
              {...orderForm.register("theme")}
            />

            <div className="flex justify-end pt-2">
              <Button type="submit" withHeart>
                Ver fechas disponibles
              </Button>
            </div>
          </form>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="font-serif text-2xl text-cocoa">
                {previewHumanReview ? "Elige tu fecha preferida" : "Elige la fecha de tu celebración"}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                Solo mostramos como disponibles los días con espacio suficiente
                para tu pedido.
              </p>
            </div>

            {(previewHumanReview || humanReview) && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-gold/60 bg-yellow/10 px-4 py-3 text-sm leading-relaxed text-cocoa">
                <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
                <p>{HUMAN_REVIEW_DATE_NOTICE}</p>
              </div>
            )}

            {availabilityError ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <span>{availabilityError}</span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => orderRaw && loadAvailability(orderRaw, monthISO)}
                  className="!px-4 !py-1.5 text-xs"
                >
                  Reintentar
                </Button>
              </div>
            ) : (
              <AvailabilityCalendar
                monthISO={monthISO}
                minMonthISO={minMonthISO}
                maxMonthISO={maxMonthISO}
                todayISO={todayISO}
                daysByDate={daysByDate}
                selectedDate={selectedDate}
                loading={loadingDays}
                onMonthChange={(next) => {
                  setMonthISO(next);
                  setNearbyForDate(null);
                  if (orderRaw) void loadAvailability(orderRaw, next);
                }}
                onSelect={handleSelectDay}
                onSelectUnavailable={handleSelectUnavailable}
              />
            )}

            {nearbyForDate && (
              <div className="rounded-2xl border border-border-soft bg-cream px-4 py-3 text-sm text-cocoa">
                {nearbyForDate.options.length > 0 ? (
                  <>
                    <p>
                      El {formatDateEs(nearbyForDate.date)} ya no tiene espacio para
                      tu pedido. Fechas cercanas con espacio:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {nearbyForDate.options.map((option) => (
                        <button
                          key={option.date}
                          type="button"
                          onClick={() => applyAlternative(option.date)}
                          className="rounded-full border border-terracotta px-3 py-1 text-xs text-terracotta-dark transition-colors hover:bg-terracotta/10"
                        >
                          {formatDateEs(option.date)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p>
                    El {formatDateEs(nearbyForDate.date)} ya no tiene espacio para tu
                    pedido y este mes no tiene fechas cercanas con espacio. Prueba
                    con otro mes.
                  </p>
                )}
              </div>
            )}

            {!loadingDays && !availabilityError && !hasSelectableDays && (
              <div
                role="status"
                className="rounded-2xl border border-gold/50 bg-yellow/10 px-4 py-3 text-sm leading-relaxed text-cocoa"
              >
                <p className="font-medium">
                  No hay fechas disponibles este mes para este tipo de torta.
                </p>
                <p className="mt-1 text-text-secondary">
                  {previewHumanReview || humanReview
                    ? "Como la recomendación provisional usa la carga máxima, solo puedes enviar una fecha preferida cuando aparezca un día seleccionable."
                    : "Puedes revisar otro mes o volver al paso anterior para simplificar el diseño."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(0)}
                  className="mt-3 !px-4 !py-1.5 text-xs"
                >
                  Simplificar mi diseño
                </Button>
              </div>
            )}

            {selectedDate && selectedDay?.canAccept && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-terracotta/40 bg-terracotta/5 px-4 py-3 text-sm text-cocoa">
                <CalendarHeart aria-hidden className="mt-0.5 size-4 shrink-0 text-terracotta" />
                <p>
                  {previewHumanReview || humanReview ? (
                    <>
                      Fecha preferida: <strong>{formatDateEs(selectedDate)}</strong>{" "}
                      (aún no quedará reservada).
                    </>
                  ) : (
                    <>
                      Fecha elegida: <strong>{formatDateEs(selectedDate)}</strong>
                      {selectedDay.isLastSlot && " — es el último espacio de ese día."}
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(0)}>
                Volver
              </Button>
              <Button
                type="button"
                disabled={!selectedDate || !selectedDay?.canAccept || loadingDays}
                onClick={() => setStep(2)}
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === 2 && orderRaw && selectedDate && (
          <form
            noValidate
            onSubmit={contactForm.handleSubmit(handleContactSubmit)}
            className="flex flex-col gap-5"
          >
            <div>
              <h2 className="font-serif text-2xl text-cocoa">Tus datos</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Para confirmar tu {previewHumanReview ? "solicitud" : "reserva"} y
                mantenerte al tanto.
              </p>
            </div>

            <div className="rounded-2xl border border-border-soft bg-cream px-4 py-3 text-sm text-cocoa">
              <p className="font-medium">Resumen de tu pedido</p>
              <ul className="mt-1.5 space-y-0.5 text-text-secondary">
                <li>
                  {previewHumanReview ? "Fecha preferida (por confirmar)" : "Fecha"}:{" "}
                  <strong className="text-cocoa">{formatDateEs(selectedDate)}</strong>
                </li>
                <li>
                  Torta de {orderRaw.tiers === "two_or_more" ? "varios pisos" : "un piso"} para{" "}
                  {orderRaw.guestCount} personas · {flavorLabel}
                </li>
                {orderRaw.theme && <li>Tema: {orderRaw.theme}</li>}
              </ul>
            </div>

            {/* Honeypot (mismo criterio del Reto 2): oculto para personas. */}
            <div
              className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
              aria-hidden="true"
            >
              <label htmlFor="companyWebsite">No completar este campo</label>
              <input
                id="companyWebsite"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                {...contactForm.register("companyWebsite")}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <InputField
                label="Nombre"
                required
                placeholder="Tu nombre completo"
                autoComplete="name"
                error={contactForm.formState.errors.customerName?.message}
                {...contactForm.register("customerName")}
              />
              <InputField
                label="WhatsApp"
                required
                type="tel"
                placeholder="0414 1234567"
                autoComplete="tel"
                hint="Con este número te contactaremos."
                error={contactForm.formState.errors.phone?.message}
                {...contactForm.register("phone")}
              />
            </div>

            <InputField
              label="Correo"
              required
              type="email"
              placeholder="tucorreo@ejemplo.com"
              autoComplete="email"
              hint="Aquí te enviaremos la confirmación."
              error={contactForm.formState.errors.email?.message}
              {...contactForm.register("email")}
            />

            <RadioGroup
              legend="¿Cómo recibirás tu torta?"
              error={contactForm.formState.errors.fulfillmentType?.message}
            >
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="pickup"
                  className={RADIO_CLASSES}
                  {...contactForm.register("fulfillmentType")}
                />
                La retiro yo
              </label>
              <label className="flex items-center gap-2 text-sm text-cocoa">
                <input
                  type="radio"
                  value="delivery"
                  className={RADIO_CLASSES}
                  {...contactForm.register("fulfillmentType")}
                />
                Delivery (costo adicional)
              </label>
            </RadioGroup>

            {fulfillmentType === "delivery" && (
              <TextareaField
                label="Dirección o zona de entrega"
                required
                rows={2}
                placeholder="Urbanización, punto de referencia…"
                error={contactForm.formState.errors.deliveryDetails?.message}
                {...contactForm.register("deliveryDetails")}
              />
            )}

            {submitError && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <p className="flex items-start gap-2">
                  <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {submitError.message}
                </p>
                {submitError.alternatives && submitError.alternatives.length > 0 && (
                  <div className="flex flex-wrap gap-2 pl-6">
                    {submitError.alternatives.map((option) => (
                      <button
                        key={option.date}
                        type="button"
                        onClick={() => applyConflictAlternative(option.date)}
                        className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs text-red-800 transition-colors hover:border-red-500"
                      >
                        {formatDateEs(option.date)}
                        {option.isLastSlot && " (último espacio)"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setStep(1);
                  if (orderRaw) void loadAvailability(orderRaw, monthISO);
                }}
              >
                Volver
              </Button>
              <Button type="submit" withHeart loading={submitting} disabled={submitting}>
                {previewHumanReview ? "Enviar mi solicitud" : "Reservar mi fecha"}
              </Button>
            </div>
          </form>
        )}

        {step === 3 && confirmation && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            {confirmation.status === "pending_deposit" ? (
              <>
                <CheckCircle2 aria-hidden className="size-12 text-terracotta" />
                <h2 className="font-serif text-2xl text-cocoa">¡Recibimos tu reserva!</h2>
                <p className="text-sm text-text-secondary">
                  Tu fecha quedó apartada, pendiente del anticipo.
                </p>
              </>
            ) : (
              <>
                <Sparkles aria-hidden className="size-12 text-gold" />
                <h2 className="font-serif text-2xl text-cocoa">
                  Tu solicitud está en revisión
                </h2>
                <p className="max-w-md text-sm leading-relaxed text-text-secondary">
                  {HUMAN_REVIEW_DATE_NOTICE}
                </p>
              </>
            )}

            <dl className="w-full max-w-sm rounded-2xl border border-border-soft bg-cream px-5 py-4 text-left text-sm">
              <div className="flex items-center justify-between gap-4 py-1.5">
                <dt className="text-text-secondary">Código</dt>
                <dd className="font-mono text-base font-semibold tracking-wider text-terracotta-dark">
                  {confirmation.code}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-border-soft py-1.5">
                <dt className="text-text-secondary">
                  {confirmation.status === "pending_deposit" ? "Fecha" : "Fecha preferida"}
                </dt>
                <dd className="text-cocoa">{formatDateEs(confirmation.celebrationDate)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-border-soft py-1.5">
                <dt className="text-text-secondary">Estado</dt>
                <dd className="text-cocoa">
                  {confirmation.status === "pending_deposit"
                    ? `Pendiente del anticipo (${DEPOSIT_PERCENT} %)`
                    : "En revisión personalizada (fecha no reservada)"}
                </dd>
              </div>
            </dl>

            <p className="max-w-md text-sm leading-relaxed text-text-secondary">
              {confirmation.status === "pending_deposit" ? (
                <>
                  <strong className="text-cocoa">Siguiente paso:</strong> {BUSINESS_NAME}{" "}
                  te contactará para coordinar el anticipo del {DEPOSIT_PERCENT} % y
                  confirmar tu pedido. Guarda tu código{" "}
                  <span className="font-mono">{confirmation.code}</span> para cualquier
                  consulta.
                </>
              ) : (
                <>
                  <strong className="text-cocoa">Siguiente paso:</strong> revisaremos tu
                  diseño y te contactaremos para confirmar disponibilidad y precio.
                  Guarda tu código <span className="font-mono">{confirmation.code}</span>.
                </>
              )}
            </p>

            <Button href="/" variant="outline">
              Volver al inicio
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

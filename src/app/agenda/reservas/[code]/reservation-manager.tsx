"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CalendarDays, Clock3, MapPin, PackageCheck, XCircle } from "lucide-react";
import AvailabilityCalendar from "@/app/agenda/availability-calendar";
import {
  cancelManagedReservation,
  fetchRescheduleAvailability,
  rescheduleManagedReservation,
} from "@/lib/actions/manage-reservation";
import { addDaysISO } from "@/lib/business-dates";
import { formatDateEs } from "@/email/format-date";
import type { DayAvailability, PublicReservation, ReservationStatus } from "@/reservations/types";

const STATUS_COPY: Record<
  ReservationStatus,
  { label: string; title: string; description: string }
> = {
  pending_deposit: {
    label: "Pendiente de anticipo",
    title: "Solicitud recibida",
    description:
      "Apartamos provisionalmente la fecha mientras coordinamos contigo el anticipo del 50%. Esto todavía no confirma el pedido.",
  },
  confirmed: {
    label: "Pedido confirmado",
    title: "Tu pedido está confirmado",
    description:
      "Recibimos la confirmación del negocio. Los cambios siguen sujetos a disponibilidad y a la política de preparación.",
  },
  human_review: {
    label: "En revisión",
    title: "Solicitud en revisión personalizada",
    description:
      "La fecha mostrada es tu preferencia y todavía no está reservada. Revisaremos el diseño y te contactaremos.",
  },
  cancelled: {
    label: "Cancelada",
    title: "Solicitud cancelada",
    description: "Esta solicitud fue cancelada y ya no admite acciones desde este enlace.",
  },
  expired: {
    label: "Expirada",
    title: "Solicitud expirada",
    description: "Esta solicitud ya no está activa. Escríbenos si quieres comenzar una nueva.",
  },
};

interface ReservationManagerProps {
  initialReservation: PublicReservation;
  token: string;
}

export default function ReservationManager({
  initialReservation,
  token,
}: ReservationManagerProps) {
  const [reservation, setReservation] = useState(initialReservation);
  const [mode, setMode] = useState<"summary" | "reschedule" | "cancel">("summary");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const copy = STATUS_COPY[reservation.status];
  const showError = useCallback(
    (text: string) => setMessage({ kind: "error", text }),
    [],
  );
  const finishReschedule = useCallback((updated: PublicReservation, text: string) => {
    setReservation(updated);
    setMessage({ kind: "success", text });
    setMode("summary");
  }, []);
  const finishCancellation = useCallback((updated: PublicReservation, text: string) => {
    setReservation(updated);
    setMessage({ kind: "success", text });
    setMode("summary");
  }, []);

  return (
    <main className="min-h-full flex-1 bg-cream px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="text-center">
          <p className="font-script text-3xl text-terracotta sm:text-4xl">Familia Ponquesito</p>
          <h1 className="mt-2 font-serif text-3xl text-cocoa sm:text-4xl">{copy.title}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            {copy.description}
          </p>
        </header>

        {message && (
          <div
            role="status"
            tabIndex={-1}
            className={`rounded-2xl border p-4 text-sm ${
              message.kind === "success"
                ? "border-green-700/20 bg-green-50 text-green-900"
                : "border-terracotta/25 bg-terracotta/10 text-cocoa"
            }`}
          >
            {message.text}
          </div>
        )}

        <section className="rounded-3xl border border-border-soft bg-cream-light p-5 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-4 border-b border-border-soft pb-5 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                Código de reserva
              </p>
              <p className="mt-1 font-serif text-2xl text-cocoa">{reservation.code}</p>
            </div>
            <span className="w-fit rounded-full bg-terracotta/10 px-4 py-2 text-sm font-semibold text-terracotta-dark">
              {copy.label}
            </span>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Detail icon={<CalendarDays />} label={reservation.status === "human_review" ? "Fecha preferida" : "Fecha"}>
              {formatDateEs(reservation.celebrationDate)}
            </Detail>
            <Detail icon={<PackageCheck />} label="Tu torta">
              {reservation.guestCount} personas · {reservation.flavor}
              {reservation.theme ? ` · ${reservation.theme}` : ""}
            </Detail>
            <Detail icon={<MapPin />} label="Entrega">
              {reservation.fulfillmentType === "pickup"
                ? "Retiro por el cliente"
                : reservation.deliveryDetails || "Delivery coordinado"}
            </Detail>
            <Detail icon={<Clock3 />} label="Próximo paso">
              {nextStep(reservation.status)}
            </Detail>
          </div>

          {mode === "summary" && (reservation.canReschedule || reservation.canCancel) && (
            <div className="mt-7 flex flex-col gap-3 border-t border-border-soft pt-6 sm:flex-row">
              {reservation.canReschedule && (
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setMode("reschedule");
                  }}
                  className="rounded-full bg-terracotta px-5 py-3 font-semibold text-white hover:bg-terracotta-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
                >
                  {reservation.status === "human_review"
                    ? "Cambiar fecha preferida"
                    : "Reprogramar fecha"}
                </button>
              )}
              {reservation.canCancel && (
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setMode("cancel");
                  }}
                  className="rounded-full border border-terracotta px-5 py-3 font-semibold text-terracotta-dark hover:bg-terracotta/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
                >
                  Cancelar solicitud
                </button>
              )}
            </div>
          )}
        </section>

        {mode === "reschedule" && (
          <ReschedulePanel
            reservation={reservation}
            token={token}
            onClose={() => setMode("summary")}
            onSuccess={finishReschedule}
            onError={showError}
          />
        )}

        {mode === "cancel" && (
          <CancelPanel
            reservation={reservation}
            token={token}
            onClose={() => setMode("summary")}
            onSuccess={finishCancellation}
            onError={showError}
          />
        )}
      </div>
    </main>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-terracotta [&>svg]:size-5" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
        <p className="mt-1 text-sm leading-6 text-cocoa">{children}</p>
      </div>
    </div>
  );
}

function ReschedulePanel({
  reservation,
  token,
  onClose,
  onSuccess,
  onError,
}: {
  reservation: PublicReservation;
  token: string;
  onClose: () => void;
  onSuccess: (reservation: PublicReservation, message: string) => void;
  onError: (message: string) => void;
}) {
  const initialMonth = reservation.celebrationDate.slice(0, 7);
  const [monthISO, setMonthISO] = useState(initialMonth);
  const [todayISO, setTodayISO] = useState(reservation.celebrationDate);
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await fetchRescheduleAvailability({
        code: reservation.code,
        token,
        monthISO,
      });
      if (!result.ok) {
        onError(result.message);
        return;
      }
      setTodayISO(result.todayISO);
      setDays(result.days);
    });
  }, [monthISO, onError, reservation.code, token]);

  const daysByDate = useMemo(
    () => Object.fromEntries(days.map((day) => [day.date, day])),
    [days],
  );
  const minMonthISO = todayISO.slice(0, 7);
  const maxMonthISO = addDaysISO(todayISO, 60).slice(0, 7);

  function submit() {
    if (!selectedDate || !confirmed) return;
    startTransition(async () => {
      const result = await rescheduleManagedReservation({
        code: reservation.code,
        token,
        newDate: selectedDate,
        confirmed: true,
      });
      if (result.ok) onSuccess(result.reservation, result.message);
      else onError(result.message);
    });
  }

  return (
    <section
      aria-labelledby="reschedule-title"
      className="rounded-3xl border border-border-soft bg-cream-light p-5 shadow-sm sm:p-8"
    >
      <h2 id="reschedule-title" className="font-serif text-2xl text-cocoa">
        {reservation.status === "human_review" ? "Cambia tu fecha preferida" : "Reprograma tu fecha"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        La fecha actual es {formatDateEs(reservation.celebrationDate)}. Selecciona otra fecha y
        confírmala expresamente.
        {reservation.status === "human_review" &&
          " La disponibilidad es una referencia provisional: tu solicitud seguirá en revisión y no consumirá capacidad."}
      </p>
      <div className="mt-6">
        <AvailabilityCalendar
          monthISO={monthISO}
          minMonthISO={minMonthISO}
          maxMonthISO={maxMonthISO}
          todayISO={todayISO}
          daysByDate={daysByDate}
          selectedDate={selectedDate}
          loading={loading}
          onMonthChange={(month) => {
            setSelectedDate(null);
            setConfirmed(false);
            setMonthISO(month);
          }}
          onSelect={(day) => {
            if (day.date === reservation.celebrationDate) {
              onError("Selecciona una fecha diferente a la actual.");
              return;
            }
            setSelectedDate(day.date);
            setConfirmed(false);
          }}
          onSelectUnavailable={() => onError("Esa fecha no está disponible. Elige otra.")}
        />
      </div>
      {selectedDate && (
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl bg-cream p-4 text-sm text-cocoa">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-4 accent-terracotta"
          />
          Confirmo que quiero cambiar a {formatDateEs(selectedDate)}.
        </label>
      )}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={loading} className="rounded-full px-5 py-3 font-semibold text-cocoa">
          Volver
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!selectedDate || !confirmed || loading}
          className="rounded-full bg-terracotta px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Confirmar nueva fecha"}
        </button>
      </div>
    </section>
  );
}

function CancelPanel({
  reservation,
  token,
  onClose,
  onSuccess,
  onError,
}: {
  reservation: PublicReservation;
  token: string;
  onClose: () => void;
  onSuccess: (reservation: PublicReservation, message: string) => void;
  onError: (message: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, startTransition] = useTransition();

  return (
    <section
      aria-labelledby="cancel-title"
      className="rounded-3xl border border-terracotta/30 bg-cream-light p-5 shadow-sm sm:p-8"
    >
      <div className="flex gap-3">
        <XCircle aria-hidden className="mt-1 size-6 shrink-0 text-terracotta" />
        <div>
          <h2 id="cancel-title" className="font-serif text-2xl text-cocoa">
            Cancela tu solicitud
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Esta acción libera la fecha cuando corresponde y no puede deshacerse desde la
            aplicación.
          </p>
        </div>
      </div>
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-cream p-4 text-sm text-cocoa">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 size-4 accent-terracotta"
        />
        Sí, confirmo que quiero cancelar la solicitud {reservation.code}.
      </label>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={loading} className="rounded-full px-5 py-3 font-semibold text-cocoa">
          Conservar solicitud
        </button>
        <button
          type="button"
          disabled={!confirmed || loading}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelManagedReservation({
                code: reservation.code,
                token,
                confirmed: true,
              });
              if (result.ok) onSuccess(result.reservation, result.message);
              else onError(result.message);
            })
          }
          className="rounded-full bg-terracotta-dark px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Cancelando…" : "Cancelar definitivamente"}
        </button>
      </div>
    </section>
  );
}

function nextStep(status: ReservationStatus) {
  if (status === "pending_deposit") return "Coordinar el anticipo del 50% con Karem.";
  if (status === "confirmed") return "Prepararemos tu pedido para la fecha indicada.";
  if (status === "human_review") return "Revisaremos el diseño y te contactaremos.";
  if (status === "cancelled") return "No hay acciones pendientes.";
  return "Contáctanos si deseas iniciar una nueva solicitud.";
}

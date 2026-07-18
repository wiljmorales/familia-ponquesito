"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { addMonthsISO, buildMonthGrid, monthLabelEs } from "@/reservations/calendar";
import type { DayAvailability } from "@/reservations/types";
import { formatDateEs } from "@/email/format-date";

/**
 * Calendario mensual del paso "La fecha". Solo pinta lo que el backend
 * decidió por día (DayAvailability); no recalcula ninguna regla. Los días
 * llenos o bloqueados siguen siendo clicables para ofrecer alternativas
 * cercanas; los días pasados o sin datos, no.
 */

const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

const STATUS_LABELS: Record<DayAvailability["status"], string> = {
  available: "disponible",
  low: "pocos espacios",
  full: "sin disponibilidad",
  blocked: "fecha bloqueada",
  too_soon: "requiere más anticipación",
  out_of_window: "fuera del período de agenda",
};

const SELECTABLE_CLASSES: Record<"available" | "low", string> = {
  available:
    "border-border-soft bg-cream-light text-cocoa hover:border-terracotta hover:bg-terracotta/10",
  low: "border-gold/70 bg-yellow/15 text-cocoa hover:border-terracotta hover:bg-terracotta/10",
};

const UNSELECTABLE_CLASSES: Record<"full" | "blocked" | "too_soon" | "out_of_window", string> = {
  full: "border-transparent bg-cream text-text-secondary/50 line-through",
  blocked: "border-transparent bg-cream text-text-secondary/40",
  too_soon: "border-transparent text-text-secondary/35",
  out_of_window: "border-transparent text-text-secondary/35",
};

interface AvailabilityCalendarProps {
  monthISO: string;
  minMonthISO: string;
  maxMonthISO: string;
  todayISO: string;
  daysByDate: Record<string, DayAvailability>;
  selectedDate: string | null;
  loading: boolean;
  onMonthChange: (monthISO: string) => void;
  onSelect: (day: DayAvailability) => void;
  onSelectUnavailable: (day: DayAvailability) => void;
}

export default function AvailabilityCalendar({
  monthISO,
  minMonthISO,
  maxMonthISO,
  todayISO,
  daysByDate,
  selectedDate,
  loading,
  onMonthChange,
  onSelect,
  onSelectUnavailable,
}: AvailabilityCalendarProps) {
  const weeks = buildMonthGrid(monthISO);
  const canGoPrev = monthISO > minMonthISO;
  const canGoNext = monthISO < maxMonthISO;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => canGoPrev && onMonthChange(addMonthsISO(monthISO, -1))}
          disabled={!canGoPrev || loading}
          aria-label="Mes anterior"
          className="rounded-full border border-border-soft p-2 text-cocoa transition-colors hover:border-terracotta hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <p className="flex items-center gap-2 font-serif text-lg capitalize text-cocoa">
          {monthLabelEs(monthISO)}
          {loading && <Loader2 aria-hidden className="size-4 animate-spin text-terracotta" />}
        </p>
        <button
          type="button"
          onClick={() => canGoNext && onMonthChange(addMonthsISO(monthISO, 1))}
          disabled={!canGoNext || loading}
          aria-label="Mes siguiente"
          className="rounded-full border border-border-soft p-2 text-cocoa transition-colors hover:border-terracotta hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((label) => (
          <span
            key={label}
            className="py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary"
          >
            {label}
          </span>
        ))}
        {weeks.flat().map((date, index) => {
          if (!date) {
            return <span key={`empty-${index}`} aria-hidden />;
          }

          const day = daysByDate[date];
          const dayNumber = Number(date.slice(8, 10));

          // Días pasados (o aún sin datos mientras carga): apagados.
          if (!day || date < todayISO) {
            return (
              <span
                key={date}
                className="flex aspect-square items-center justify-center rounded-xl text-sm text-text-secondary/30"
              >
                {dayNumber}
              </span>
            );
          }

          const isSelected = date === selectedDate;
          const selectable = day.status === "available" || day.status === "low";
          const offersAlternatives = day.status === "full" || day.status === "blocked";
          const statusLabel = isSelected ? "seleccionada" : STATUS_LABELS[day.status];

          const classes = isSelected
            ? "border-terracotta bg-terracotta font-semibold text-cream-light"
            : selectable
              ? SELECTABLE_CLASSES[day.status as "available" | "low"]
              : UNSELECTABLE_CLASSES[day.status as keyof typeof UNSELECTABLE_CLASSES];

          return (
            <button
              key={date}
              type="button"
              disabled={!selectable && !offersAlternatives}
              onClick={() => (selectable ? onSelect(day) : onSelectUnavailable(day))}
              aria-pressed={isSelected}
              aria-label={`${formatDateEs(date)}: ${statusLabel}`}
              title={statusLabel}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-terracotta-dark disabled:cursor-not-allowed ${classes}`}
            >
              {dayNumber}
              {!isSelected && day.status === "low" && (
                <span aria-hidden className="absolute bottom-1 size-1.5 rounded-full bg-gold" />
              )}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-secondary">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded border border-border-soft bg-cream-light" />
          Disponible
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="relative size-3 rounded border border-gold/70 bg-yellow/15">
            <span className="absolute inset-x-0 bottom-0 mx-auto mb-px size-1 rounded-full bg-gold" />
          </span>
          Pocos espacios
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded bg-cream text-center text-[8px] leading-3 text-text-secondary/60">
            –
          </span>
          Sin disponibilidad o bloqueada
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded border border-transparent bg-cream-light opacity-40" />
          Muy pronto o fuera del período
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded bg-terracotta" />
          Seleccionada
        </li>
      </ul>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import CakeStage from "./CakeStage";
import DesignRequestForm from "./DesignRequestForm";
import Button from "@/components/ui/Button";
import {
  TIER_OPTIONS,
  getBaseOption,
  getPlaqueOption,
  getStandOption,
  getTopperOption,
} from "@/lib/cake-builder/options";
import type { CakeDesign } from "@/lib/cake-builder/types";

const CONFETTI_COLORS = ["bg-terracotta", "bg-gold", "bg-blush", "bg-yellow"];
const CONFETTI_PIECES = 14;

/** Determinista (sin Math.random) para no generar mismatches de hidratación. */
function Confetti() {
  const pieces = Array.from({ length: CONFETTI_PIECES }, (_, i) => i);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((i) => (
        <span
          key={i}
          className={`absolute top-0 size-2 rounded-full ${CONFETTI_COLORS[i % CONFETTI_COLORS.length]} animate-[cake-confetti-fall_2.6s_ease-in_forwards]`}
          style={{
            left: `${(i * 137) % 100}%`,
            animationDelay: `${(i % 6) * 0.18}s`,
          }}
        />
      ))}
    </div>
  );
}

interface FinalViewProps {
  design: CakeDesign;
  onEdit: () => void;
  onRestart: () => void;
}

export default function FinalView({ design, onEdit, onRestart }: FinalViewProps) {
  const [showForm, setShowForm] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const tierLabel = TIER_OPTIONS.find((t) => t.tiers === design.tiers)?.label;
  const base = getBaseOption(design.tiers, design.baseVariant);
  const stand = getStandOption(design.standVariant);
  const plaque = getPlaqueOption(design.plaqueVariant);
  const topper = getTopperOption(design.topperVariant);

  const summary = [
    tierLabel && `Torta de ${tierLabel.toLowerCase()}`,
    base && `Color ${base.label.toLowerCase()}`,
    stand && `Pedestal ${stand.label.toLowerCase()}`,
    plaque
      ? `Placa ${plaque.label.toLowerCase()}${design.message ? ` con "${design.message}"` : ""}`
      : "Sin placa",
    topper ? `Topper: ${topper.label}` : "Sin topper",
  ].filter((line): line is string => Boolean(line));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10 text-center sm:py-14">
      <div className="relative w-full">
        <Confetti />
        <CakeStage design={design} />
      </div>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-serif text-3xl text-cocoa outline-none sm:text-4xl"
      >
        ¡Tu creación está lista!
      </h1>

      <ul className="flex flex-col gap-1 text-sm text-text-secondary">
        {summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {!showForm ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button type="button" onClick={() => setShowForm(true)} withHeart>
            Hacerla realidad
          </Button>
          <button
            type="button"
            onClick={onEdit}
            className="text-sm text-text-secondary underline-offset-2 hover:underline"
          >
            Editar mi diseño
          </button>
        </div>
      ) : (
        <div className="w-full text-left">
          <div className="mb-4 flex flex-col gap-1 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
              De tu imaginación a tu celebración
            </p>
            <p className="text-sm text-text-secondary">
              Cuéntanos cuándo quieres compartirla y Familia Ponquesito
              preparará una cotización personalizada inspirada en tu
              diseño.
            </p>
          </div>
          <DesignRequestForm design={design} onRestart={onRestart} />
        </div>
      )}
    </div>
  );
}

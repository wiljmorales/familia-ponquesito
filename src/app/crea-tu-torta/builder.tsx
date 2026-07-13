"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";
import CakeStage from "@/components/cake-builder/CakeStage";
import OptionGrid from "@/components/cake-builder/OptionGrid";
import MessageStep from "@/components/cake-builder/MessageStep";
import {
  BASE_OPTIONS,
  PLAQUE_OPTIONS,
  STAND_OPTIONS,
  TIER_OPTIONS,
  TOPPER_OPTIONS,
} from "@/lib/cake-builder/options";
import type { StepId } from "@/lib/cake-builder/types";
import { useCakeBuilder } from "./use-cake-builder";

const STEP_TITLE: Record<Exclude<StepId, "bienvenida">, string> = {
  tiers: "¿De cuántos pisos la imaginas?",
  color: "Elige el color de tu torta",
  pedestal: "Elige el pedestal",
  placa: "¿Quieres una placa con dedicatoria?",
  mensaje: "Escribe tu mensaje",
  topper: "Elige tu topper",
};

export default function Builder() {
  const builder = useCakeBuilder();
  const { design, steps, stepIndex, currentStep } = builder;

  if (currentStep === "bienvenida") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
        <span aria-hidden className="text-5xl">
          🎂
        </span>
        <h1 className="max-w-md font-serif text-3xl leading-tight text-cocoa sm:text-4xl">
          Crea una torta hecha con{" "}
          <em className="font-serif italic text-terracotta">amor</em>, para
          compartir
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-text-secondary sm:text-base">
          Combina colores, estilos y detalles para imaginar una torta tan
          especial como tu celebración.
        </p>
        <Button onClick={builder.start} withHeart>
          Comenzar a crear
        </Button>
        <Link
          href="/"
          className="text-xs text-text-secondary underline-offset-2 hover:underline"
        >
          ← Volver al inicio
        </Link>
      </div>
    );
  }

  const progress = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div className="flex flex-1 flex-col">
      <div className="h-1 w-full bg-border-soft">
        <div
          className="h-full bg-terracotta transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-10 lg:py-10">
        <div className="lg:sticky lg:top-6">
          <CakeStage design={design} />
        </div>

        <div className="flex flex-col gap-5">
          <h2 className="font-serif text-xl text-cocoa sm:text-2xl">
            {STEP_TITLE[currentStep]}
          </h2>

          <StepBody builder={builder} step={currentStep} />

          <div className="mt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={builder.goBack}
              className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium text-cocoa transition-colors hover:text-terracotta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark"
            >
              <ChevronLeft aria-hidden className="size-4" />
              Atrás
            </button>
            <Button
              type="button"
              onClick={builder.goNext}
              disabled={stepIndex === steps.length - 1}
              className="gap-1"
            >
              Siguiente
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBody({
  builder,
  step,
}: {
  builder: ReturnType<typeof useCakeBuilder>;
  step: Exclude<StepId, "bienvenida">;
}) {
  const { design } = builder;

  switch (step) {
    case "tiers":
      return (
        <div role="radiogroup" className="grid grid-cols-2 gap-3">
          {TIER_OPTIONS.map((option) => (
            <button
              key={option.tiers}
              type="button"
              role="radio"
              aria-checked={design.tiers === option.tiers}
              onClick={() => builder.selectTiers(option.tiers)}
              className={`flex min-h-[44px] flex-col items-center gap-2 rounded-2xl border-2 p-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark ${
                design.tiers === option.tiers
                  ? "border-terracotta bg-terracotta/10"
                  : "border-border-soft bg-cream-light hover:border-terracotta/50"
              }`}
            >
              <span className="text-sm font-medium text-cocoa">
                {option.label}
              </span>
            </button>
          ))}
        </div>
      );
    case "color":
      return (
        <OptionGrid
          options={BASE_OPTIONS[design.tiers]}
          selectedId={design.baseVariant}
          onSelect={(id) => id && builder.selectBase(id)}
        />
      );
    case "pedestal":
      return (
        <OptionGrid
          options={STAND_OPTIONS}
          selectedId={design.standVariant}
          onSelect={(id) => id && builder.selectStand(id)}
        />
      );
    case "placa":
      return (
        <OptionGrid
          options={PLAQUE_OPTIONS}
          selectedId={design.plaqueVariant}
          onSelect={builder.selectPlaque}
          noneLabel="Sin placa"
        />
      );
    case "mensaje":
      return (
        <MessageStep message={design.message} onChange={builder.setMessage} />
      );
    case "topper":
      return (
        <OptionGrid
          options={TOPPER_OPTIONS}
          selectedId={design.topperVariant}
          onSelect={builder.selectTopper}
          noneLabel="Sin topper"
        />
      );
  }
}

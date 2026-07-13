"use client";

import { useMemo, useState } from "react";
import { DEFAULT_DESIGN, STEP_ORDER, firstBaseVariant } from "@/lib/cake-builder/options";
import type { CakeDesign, StepId, Tiers } from "@/lib/cake-builder/types";

export function useCakeBuilder() {
  const [design, setDesign] = useState<CakeDesign>(DEFAULT_DESIGN);
  const [stepIndex, setStepIndex] = useState(0);

  // El paso "mensaje" solo aplica si hay placa seleccionada.
  const steps = useMemo<StepId[]>(
    () => STEP_ORDER.filter((step) => step !== "mensaje" || design.plaqueVariant !== null),
    [design.plaqueVariant],
  );

  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[safeIndex];

  function selectTiers(tiers: Tiers) {
    setDesign((prev) => ({
      ...prev,
      tiers,
      baseVariant: firstBaseVariant(tiers),
    }));
  }

  function selectBase(baseVariant: string) {
    setDesign((prev) => ({ ...prev, baseVariant }));
  }

  function selectStand(standVariant: string) {
    setDesign((prev) => ({ ...prev, standVariant }));
  }

  function selectPlaque(plaqueVariant: string | null) {
    setDesign((prev) => ({
      ...prev,
      plaqueVariant,
      message: plaqueVariant ? prev.message : "",
    }));
  }

  function setMessage(message: string) {
    setDesign((prev) => ({ ...prev, message }));
  }

  function selectTopper(topperVariant: string | null) {
    setDesign((prev) => ({ ...prev, topperVariant }));
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function start() {
    setStepIndex(steps.indexOf("tiers"));
  }

  function restart() {
    setDesign(DEFAULT_DESIGN);
    setStepIndex(0);
  }

  return {
    design,
    steps,
    stepIndex: safeIndex,
    currentStep,
    selectTiers,
    selectBase,
    selectStand,
    selectPlaque,
    setMessage,
    selectTopper,
    goNext,
    goBack,
    start,
    restart,
  };
}

export type CakeBuilderState = ReturnType<typeof useCakeBuilder>;

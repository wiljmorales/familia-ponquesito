import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "@/types/prototype";
import { orderProgressSteps, PROGRESS_LABELS } from "./progress";

describe("orderProgressSteps", () => {
  it("un pedido nuevo está en el primer paso y el resto por venir", () => {
    const steps = orderProgressSteps("new");
    expect(steps.map((step) => step.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("esperando anticipo: solicitud, revisión y cotización completadas", () => {
    const steps = orderProgressSteps("waiting_deposit");
    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "current",
      "upcoming",
    ]);
  });

  it("confirmado es el paso final activo (no queda nada por venir)", () => {
    const steps = orderProgressSteps("confirmed");
    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "current",
    ]);
  });

  it("siempre devuelve los cinco pasos con sus labels, para cualquier estado", () => {
    for (const status of ORDER_STATUSES) {
      const steps = orderProgressSteps(status);
      expect(steps.map((step) => step.label)).toEqual([...PROGRESS_LABELS]);
      expect(steps.filter((step) => step.state === "current")).toHaveLength(1);
    }
  });
});

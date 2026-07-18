import { describe, expect, it } from "vitest";
import { classifyOrder, type OrderClassificationInput } from "./classify-order";

function baseInput(overrides: Partial<OrderClassificationInput> = {}): OrderClassificationInput {
  return {
    guestCount: 20,
    tiers: "one",
    isCustomDesign: false,
    hasReferenceImage: false,
    designDescription: "Torta de chocolate para cumpleaños",
    ...overrides,
  };
}

describe("classifyOrder", () => {
  it("clasifica como sencilla (1 punto) un piso sin diseño personalizado", () => {
    const result = classifyOrder(baseInput());
    expect(result).toMatchObject({ kind: "classified", complexity: "simple", points: 1 });
  });

  it("clasifica como diseño especial (3 puntos) cuando el cliente declara varios pisos", () => {
    const result = classifyOrder(baseInput({ tiers: "two_or_more" }));
    expect(result).toMatchObject({ kind: "classified", complexity: "complex", points: 3 });
  });

  it("clasifica como personalizada (2 puntos) con decoración temática", () => {
    const result = classifyOrder(baseInput({ isCustomDesign: true }));
    expect(result).toMatchObject({ kind: "classified", complexity: "custom", points: 2 });
  });

  it("clasifica como personalizada (2 puntos) cuando trae imagen de referencia", () => {
    const result = classifyOrder(baseInput({ hasReferenceImage: true }));
    expect(result).toMatchObject({ kind: "classified", complexity: "custom", points: 2 });
  });

  it("clasifica como personalizada (2 puntos) los pedidos grandes", () => {
    const result = classifyOrder(baseInput({ guestCount: 40 }));
    expect(result).toMatchObject({ kind: "classified", complexity: "custom", points: 2 });
  });

  it("los pedidos justo bajo el umbral de invitados siguen siendo sencillos", () => {
    const result = classifyOrder(baseInput({ guestCount: 39 }));
    expect(result).toMatchObject({ kind: "classified", complexity: "simple", points: 1 });
  });

  it("pide revisión humana si la descripción menciona pisos que contradicen la respuesta cerrada", () => {
    const result = classifyOrder(
      baseInput({ designDescription: "Quiero una torta de tres pisos con flores" }),
    );
    expect(result.kind).toBe("human_required");
    if (result.kind === "human_required") {
      expect(result.estimatedPoints).toBe(3);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it("pide revisión humana ante señales estructurales en el texto libre", () => {
    const result = classifyOrder(
      baseInput({ designDescription: "Una torta antigravedad con luces y movimiento" }),
    );
    expect(result.kind).toBe("human_required");
  });

  it("NO pide revisión si el cliente ya declaró varios pisos aunque el texto los mencione", () => {
    const result = classifyOrder(
      baseInput({
        tiers: "two_or_more",
        designDescription: "Torta de dos pisos para boda",
      }),
    );
    expect(result).toMatchObject({ kind: "classified", complexity: "complex", points: 3 });
  });

  it("la clasificación es determinística: misma entrada, mismo resultado", () => {
    const input = baseInput({ isCustomDesign: true, guestCount: 55 });
    expect(classifyOrder(input)).toEqual(classifyOrder(input));
  });
});

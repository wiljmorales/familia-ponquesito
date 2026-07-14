import { describe, expect, it } from "vitest";
import { describeCakeDesign } from "./design-summary";
import type { CakeDesign } from "./types";

const FULL_DESIGN: CakeDesign = {
  version: 1,
  tiers: 1,
  baseVariant: "one-tier-cream",
  standVariant: "stand-blush",
  plaqueVariant: "plaque-blush-gold",
  message: "Feliz cumpleaños",
  topperVariant: "topper-princess",
};

describe("describeCakeDesign", () => {
  it("describe un diseño completo con placa, mensaje y topper", () => {
    const summary = describeCakeDesign(FULL_DESIGN);
    expect(summary).toEqual([
      "Torta de un piso",
      "Color crema",
      "Pedestal rosado",
      'Placa rosada y dorada con "Feliz cumpleaños"',
      "Topper: Princess",
    ]);
  });

  it("describe un diseño sin placa ni topper", () => {
    const summary = describeCakeDesign({
      ...FULL_DESIGN,
      plaqueVariant: null,
      topperVariant: null,
      message: "",
    });
    expect(summary).toEqual([
      "Torta de un piso",
      "Color crema",
      "Pedestal rosado",
      "Sin placa",
      "Sin topper",
    ]);
  });
});

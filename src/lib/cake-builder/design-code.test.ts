import { describe, expect, it } from "vitest";
import { generateDesignCode } from "./design-code";

describe("generateDesignCode", () => {
  it("sigue el formato FP-3-XXXX con el alfabeto legible", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateDesignCode()).toMatch(/^FP-3-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
  });

  it("no genera caracteres ambiguos (0, O, 1, I, L)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateDesignCode()).not.toMatch(/[0O1IL]/);
    }
  });
});

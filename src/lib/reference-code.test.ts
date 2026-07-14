import { describe, expect, it } from "vitest";
import { generateReferenceCode } from "./reference-code";

describe("generateReferenceCode", () => {
  it("sigue el formato prefix-XXXX con el alfabeto legible", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateReferenceCode("FP-2")).toMatch(
        /^FP-2-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
      );
    }
  });

  it("no genera caracteres ambiguos (0, O, 1, I, L)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateReferenceCode("FP-2")).not.toMatch(/[0O1IL]/);
    }
  });

  it("respeta cualquier prefijo recibido", () => {
    expect(generateReferenceCode("FP-3")).toMatch(/^FP-3-/);
  });
});

import { describe, expect, it } from "vitest";
import { absoluteUrl, SITE_URL } from "./site-url";

describe("absoluteUrl", () => {
  it("normaliza rutas internas con o sin slash", () => {
    expect(absoluteUrl("/agenda/reservas/FP-8-ABCD?token=uno")).toBe(
      `${SITE_URL}/agenda/reservas/FP-8-ABCD?token=uno`,
    );
    expect(absoluteUrl("agenda/reservas/FP-8-ABCD")).toBe(
      `${SITE_URL}/agenda/reservas/FP-8-ABCD`,
    );
  });

  it.each([
    "https://otro-dominio.com",
    "http://otro-dominio.com/ruta",
    "//otro-dominio.com",
    "\\\\otro-dominio.com",
    "/ruta\\engañosa",
  ])("rechaza URLs externas o ambiguas: %s", (value) => {
    expect(() => absoluteUrl(value)).toThrow("Solo se permiten rutas internas");
  });

  it("nunca depende del host del request ni de variables de preview", () => {
    expect(absoluteUrl("/agenda")).toBe(`${SITE_URL}/agenda`);
  });
});

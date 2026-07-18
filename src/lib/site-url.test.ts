import { describe, expect, it } from "vitest";
import { absoluteUrl, canonicalSiteUrl, SITE_URL } from "./site-url";

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

  it("nunca depende del host del request", () => {
    expect(absoluteUrl("/agenda")).toBe(`${SITE_URL}/agenda`);
  });

  it("acepta un origen HTTPS explícito para Preview", () => {
    expect(canonicalSiteUrl("https://agenda-reto-8.vercel.app")).toBe(
      "https://agenda-reto-8.vercel.app",
    );
  });

  it.each([
    "http://agenda-reto-8.vercel.app",
    "https://user:secret@agenda-reto-8.vercel.app",
    "https://agenda-reto-8.vercel.app/ruta",
    "https://agenda-reto-8.vercel.app?token=secreto",
    "no-es-url",
  ])("rechaza una URL canónica insegura: %s", (value) => {
    expect(() => canonicalSiteUrl(value)).toThrow("APP_CANONICAL_URL");
  });
});

import { describe, expect, it } from "vitest";
import { describeCakeRequest } from "./cake-request-summary";

describe("describeCakeRequest", () => {
  it("describe una solicitud con etiquetas legibles", () => {
    const summary = describeCakeRequest({
      celebrationType: "cumpleanos",
      guestCount: 20,
      preferredFlavor: "red_velvet",
      cakeDescription: "Torta con flores de crema en tonos pastel.",
    });

    expect(summary).toEqual([
      "Celebración: Cumpleaños",
      "Personas: 20",
      "Sabor preferido: Red velvet",
      "Descripción: Torta con flores de crema en tonos pastel.",
    ]);
  });

  it("usa el valor crudo si el tipo o sabor no están en el catálogo", () => {
    const summary = describeCakeRequest({
      celebrationType: "valor-desconocido",
      guestCount: 5,
      preferredFlavor: "otro-desconocido",
      cakeDescription: "x",
    });

    expect(summary).toContain("Celebración: valor-desconocido");
    expect(summary).toContain("Sabor preferido: otro-desconocido");
  });
});

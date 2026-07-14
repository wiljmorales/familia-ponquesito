import { describe, expect, it } from "vitest";
import {
  buildCustomerContactWhatsappLink,
  buildWhatsappMessageUrl,
  normalizeWhatsapp,
} from "./whatsapp";

describe("normalizeWhatsapp", () => {
  it("normaliza un número local venezolano (0414...) a formato internacional", () => {
    expect(normalizeWhatsapp("04141234567")).toBe("+584141234567");
  });

  it("normaliza un número que ya trae 58 sin +", () => {
    expect(normalizeWhatsapp("584141234567")).toBe("+584141234567");
  });

  it("respeta un número internacional que ya trae +", () => {
    expect(normalizeWhatsapp("+13051234567")).toBe("+13051234567");
  });
});

describe("buildWhatsappMessageUrl", () => {
  it("agrega el mensaje como query param cuando la URL no tiene uno", () => {
    expect(buildWhatsappMessageUrl("https://wa.me/584140000000", "Hola")).toBe(
      "https://wa.me/584140000000?text=Hola",
    );
  });

  it("usa & cuando la URL ya trae query params", () => {
    expect(buildWhatsappMessageUrl("https://wa.me/584140000000?ref=x", "Hola")).toBe(
      "https://wa.me/584140000000?ref=x&text=Hola",
    );
  });
});

describe("buildCustomerContactWhatsappLink", () => {
  it("arma un enlace wa.me con solo dígitos y el mensaje codificado", () => {
    const link = buildCustomerContactWhatsappLink("+584141234567", "Hola María");
    expect(link).toBe("https://wa.me/584141234567?text=Hola%20Mar%C3%ADa");
  });

  it("codifica caracteres especiales del mensaje (& ? # etc.)", () => {
    const link = buildCustomerContactWhatsappLink(
      "+584141234567",
      'Código FP-2-A7K2 & "urgente"? #torta',
    );
    expect(link).toContain(
      encodeURIComponent('Código FP-2-A7K2 & "urgente"? #torta'),
    );
    expect(link.startsWith("https://wa.me/584141234567?text=")).toBe(true);
  });
});

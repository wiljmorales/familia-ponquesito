import { describe, expect, it } from "vitest";
import { cakeDesignRequestSchema, cakeDesignSchema } from "./cake-design";

const VALID_DESIGN = {
  version: 1,
  tiers: 1,
  baseVariant: "one-tier-cream",
  standVariant: "stand-blush",
  plaqueVariant: "plaque-blush-gold",
  message: "Feliz cumpleaños",
  topperVariant: "topper-princess",
};

function futureDateString(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

describe("cakeDesignSchema", () => {
  it("acepta un diseño válido con placa y topper", () => {
    expect(cakeDesignSchema.safeParse(VALID_DESIGN).success).toBe(true);
  });

  it("acepta un diseño sin placa ni topper (null)", () => {
    const result = cakeDesignSchema.safeParse({
      ...VALID_DESIGN,
      plaqueVariant: null,
      topperVariant: null,
      message: "",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza una variante de base que no existe para ese número de pisos", () => {
    // "one-tier-cream" no es una variante válida para tiers: 2.
    const result = cakeDesignSchema.safeParse({ ...VALID_DESIGN, tiers: 2 });
    expect(result.success).toBe(false);
  });

  it("rechaza ids de pedestal, placa o topper que no están en el catálogo", () => {
    expect(
      cakeDesignSchema.safeParse({ ...VALID_DESIGN, standVariant: "stand-inventado" }).success,
    ).toBe(false);
    expect(
      cakeDesignSchema.safeParse({ ...VALID_DESIGN, topperVariant: "topper-inventado" }).success,
    ).toBe(false);
  });

  it("rechaza un mensaje más largo que el límite permitido", () => {
    const result = cakeDesignSchema.safeParse({
      ...VALID_DESIGN,
      message: "x".repeat(200),
    });
    expect(result.success).toBe(false);
  });
});

describe("cakeDesignRequestSchema", () => {
  const VALID_REQUEST = {
    customerName: "Ana Pérez",
    whatsapp: "04141234567",
    email: "",
    eventDate: futureDateString(5),
    guestCount: "20",
    zone: "Este de Barquisimeto",
    companyWebsite: "",
  };

  it("acepta una solicitud válida y normaliza el WhatsApp y el correo vacío", () => {
    const result = cakeDesignRequestSchema.safeParse(VALID_REQUEST);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsapp).toBe("+584141234567");
      expect(result.data.email).toBeNull();
    }
  });

  it("rechaza una fecha con menos de 3 días de anticipación", () => {
    const result = cakeDesignRequestSchema.safeParse({
      ...VALID_REQUEST,
      eventDate: futureDateString(1),
    });
    expect(result.success).toBe(false);
  });

  it("rechaza el honeypot relleno", () => {
    const result = cakeDesignRequestSchema.safeParse({
      ...VALID_REQUEST,
      companyWebsite: "http://bot.example",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un correo con formato inválido cuando se completa", () => {
    const result = cakeDesignRequestSchema.safeParse({
      ...VALID_REQUEST,
      email: "no-es-un-correo",
    });
    expect(result.success).toBe(false);
  });
});

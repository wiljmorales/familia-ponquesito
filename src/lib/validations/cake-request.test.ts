import { describe, expect, it } from "vitest";
import { cakeRequestSchema } from "./cake-request";

function futureDateString(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

describe("cakeRequestSchema", () => {
  const VALID_REQUEST = {
    customerName: "Ana Pérez",
    whatsapp: "04141234567",
    email: "ana@example.com",
    celebrationDate: futureDateString(5),
    celebrationType: "cumpleanos",
    guestCount: "20",
    preferredFlavor: "chocolate",
    cakeDescription: "Torta de chocolate con flores de crema, colores pastel.",
    companyWebsite: "",
  };

  it("acepta una solicitud válida y normaliza el WhatsApp", () => {
    const result = cakeRequestSchema.safeParse(VALID_REQUEST);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsapp).toBe("+584141234567");
      expect(result.data.email).toBe("ana@example.com");
    }
  });

  it("rechaza un correo vacío (obligatorio)", () => {
    const result = cakeRequestSchema.safeParse({ ...VALID_REQUEST, email: "" });
    expect(result.success).toBe(false);
  });

  it("rechaza un correo con formato inválido", () => {
    const result = cakeRequestSchema.safeParse({ ...VALID_REQUEST, email: "no-es-un-correo" });
    expect(result.success).toBe(false);
  });

  it("rechaza una fecha con menos de 3 días de anticipación", () => {
    const result = cakeRequestSchema.safeParse({
      ...VALID_REQUEST,
      celebrationDate: futureDateString(1),
    });
    expect(result.success).toBe(false);
  });

  it("rechaza el honeypot relleno", () => {
    const result = cakeRequestSchema.safeParse({
      ...VALID_REQUEST,
      companyWebsite: "http://bot.example",
    });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  agendaContactSchema,
  agendaOrderSchema,
  agendaReservationSchema,
} from "./agenda-reservation";

const VALID_ORDER = {
  guestCount: "20",
  tiers: "one",
  isCustomDesign: "no",
  hasReferenceImage: "no",
  designDescription: "Torta de chocolate con flores sencillas",
  flavor: "chocolate",
  theme: "",
};

const VALID_CONTACT = {
  customerName: "Ana Pérez",
  email: "ana@example.com",
  phone: "0414 1234567",
  fulfillmentType: "pickup",
  deliveryDetails: "",
  companyWebsite: "",
};

describe("agendaOrderSchema", () => {
  it("acepta un pedido válido y convierte los tipos", () => {
    const parsed = agendaOrderSchema.parse(VALID_ORDER);
    expect(parsed.guestCount).toBe(20);
    expect(parsed.theme).toBeUndefined();
  });

  it("rechaza descripciones demasiado cortas", () => {
    const result = agendaOrderSchema.safeParse({
      ...VALID_ORDER,
      designDescription: "corta",
    });
    expect(result.success).toBe(false);
  });

  it("exige responder las preguntas cerradas", () => {
    const result = agendaOrderSchema.safeParse({ ...VALID_ORDER, tiers: "" });
    expect(result.success).toBe(false);
  });

  it("acota el número de personas", () => {
    expect(agendaOrderSchema.safeParse({ ...VALID_ORDER, guestCount: "0" }).success).toBe(false);
    expect(agendaOrderSchema.safeParse({ ...VALID_ORDER, guestCount: "501" }).success).toBe(false);
    expect(agendaOrderSchema.safeParse({ ...VALID_ORDER, guestCount: "500" }).success).toBe(true);
  });
});

describe("agendaContactSchema", () => {
  it("acepta datos de contacto válidos y normaliza el teléfono", () => {
    const parsed = agendaContactSchema.parse(VALID_CONTACT);
    expect(parsed.phone).toBeTruthy();
    expect(parsed.deliveryDetails).toBeUndefined();
  });

  it("exige detalles de entrega cuando el pedido es delivery", () => {
    const missing = agendaContactSchema.safeParse({
      ...VALID_CONTACT,
      fulfillmentType: "delivery",
    });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((i) => i.path[0] === "deliveryDetails")).toBe(true);
    }

    const withDetails = agendaContactSchema.safeParse({
      ...VALID_CONTACT,
      fulfillmentType: "delivery",
      deliveryDetails: "Este de Barquisimeto, urb. X",
    });
    expect(withDetails.success).toBe(true);
  });

  it("rechaza el honeypot con contenido", () => {
    const result = agendaContactSchema.safeParse({
      ...VALID_CONTACT,
      companyWebsite: "http://spam.example",
    });
    expect(result.success).toBe(false);
  });
});

describe("agendaReservationSchema", () => {
  it("valida el envío completo (pedido + fecha + contacto)", () => {
    const result = agendaReservationSchema.safeParse({
      ...VALID_ORDER,
      ...VALID_CONTACT,
      celebrationDate: "2026-08-15",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza fechas con formato inválido", () => {
    const result = agendaReservationSchema.safeParse({
      ...VALID_ORDER,
      ...VALID_CONTACT,
      celebrationDate: "15/08/2026",
    });
    expect(result.success).toBe(false);
  });

  it("mantiene la regla de delivery en el envío completo", () => {
    const result = agendaReservationSchema.safeParse({
      ...VALID_ORDER,
      ...VALID_CONTACT,
      fulfillmentType: "delivery",
      celebrationDate: "2026-08-15",
    });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { ReservationLeadDetails } from "@/leads/types";
import { buildReservationOwnerEmail } from "./reservation-owner";

const RESERVATION: ReservationLeadDetails = {
  code: "FP-8-ABCD",
  celebrationDate: "2026-08-15",
  status: "pending_deposit",
  capacityPoints: 2,
  classificationReasons: ["Decoración personalizada."],
  guestCount: 20,
  flavorLabel: "Chocolate",
  theme: "Flores",
  designDescription: "Flores de colores",
  fulfillmentType: "delivery",
  deliveryDetails: "Zona este",
  hasReferenceImage: true,
};

const BASE = {
  reservation: RESERVATION,
  customerName: "Ana Pérez",
  customerWhatsapp: "+584141234567",
  customerEmail: "ana@example.com",
  whatsappLink: "https://wa.me/584141234567?text=Hola",
  referenceImageSignedUrl: "https://storage.example/signed-image",
  capacity: { total: 4, used: 2, remaining: 2, provisional: false },
};

describe("buildReservationOwnerEmail", () => {
  it("incluye el resumen operativo y la capacidad autoritativa", () => {
    const email = buildReservationOwnerEmail(BASE);

    for (const content of [email.html, email.text]) {
      expect(content).toContain("FP-8-ABCD");
      expect(content).toContain("Ana Pérez");
      expect(content).toContain("20");
      expect(content).toContain("Chocolate");
      expect(content).toContain("Zona este");
      expect(content).toContain("2");
      expect(content).toContain("storage.example");
      expect(content).toContain("wa.me");
    }
  });

  it("human_review destaca que no consumió capacidad y la fecha no está apartada", () => {
    const email = buildReservationOwnerEmail({
      ...BASE,
      reservation: { ...RESERVATION, status: "human_review", capacityPoints: 3 },
      capacity: { total: 4, used: 1, remaining: 3, provisional: true },
    });

    expect(email.html).toContain("REVISIÓN PERSONALIZADA");
    expect(email.text).toContain("no apartada");
    expect(email.text).toContain("no consumió capacidad");
  });

  it("escapa contenido dinámico y jamás contiene token, hash ni URL privada", () => {
    const email = buildReservationOwnerEmail({
      ...BASE,
      customerName: "<script>Ana</script>",
      reservation: {
        ...RESERVATION,
        designDescription: "<img src=x onerror=alert(1)>",
      },
    });
    const serialized = `${email.subject} ${email.html} ${email.text}`;

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(serialized).not.toContain("token=secreto");
    expect(serialized).not.toMatch(/manageUrl|manage_token_hash/i);
  });
});

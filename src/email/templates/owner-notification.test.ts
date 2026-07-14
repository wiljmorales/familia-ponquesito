import { describe, expect, it } from "vitest";
import { buildOwnerNotificationEmail } from "./owner-notification";

const BASE_INPUT = {
  source: "cake_request" as const,
  referenceCode: "FP-2-A7K2",
  priority: "urgent" as const,
  customerName: "Ana Pérez",
  customerWhatsapp: "+584141234567",
  customerEmail: "ana@example.com",
  celebrationDate: "2026-02-01",
  summaryLines: ["Celebración: Cumpleaños"],
  whatsappLink: "https://wa.me/584141234567?text=Hola",
};

describe("buildOwnerNotificationEmail", () => {
  it("escapa HTML en nombre, correo y resumen", () => {
    const email = buildOwnerNotificationEmail({
      ...BASE_INPUT,
      customerName: '<img src=x onerror=alert(1)>',
      summaryLines: ['Descripción: <script>alert(1)</script>'],
    });

    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("no interpola texto libre del cliente en el asunto", () => {
    const email = buildOwnerNotificationEmail({
      ...BASE_INPUT,
      customerName: "Nombre con <html> raro",
    });

    expect(email.subject).not.toContain("Nombre con");
    expect(email.subject).toContain("FP-2-A7K2");
    expect(email.subject).toContain("URGENTE");
  });

  it("incluye el enlace de WhatsApp precargado", () => {
    const email = buildOwnerNotificationEmail(BASE_INPUT);
    expect(email.html).toContain(BASE_INPUT.whatsappLink);
    expect(email.text).toContain(BASE_INPUT.whatsappLink);
  });

  it("incluye la imagen de referencia solo cuando se provee", () => {
    const withImage = buildOwnerNotificationEmail({
      ...BASE_INPUT,
      referenceImageSignedUrl: "https://signed.example.com/img.jpg?token=abc",
    });
    expect(withImage.html).toContain("https://signed.example.com/img.jpg?token=abc");
    expect(withImage.text).toContain("https://signed.example.com/img.jpg?token=abc");

    const withoutImage = buildOwnerNotificationEmail(BASE_INPUT);
    expect(withoutImage.html).not.toContain("Imagen de referencia");
    expect(withoutImage.text).not.toContain("Imagen de referencia");
  });
});

import { describe, expect, it } from "vitest";
import { buildCustomerConfirmationEmail } from "./customer-confirmation";

const MALICIOUS_NAME = '<img src=x onerror=alert(1)>Ana';

describe("buildCustomerConfirmationEmail", () => {
  it("escapa HTML en el nombre dentro del cuerpo", () => {
    const email = buildCustomerConfirmationEmail({
      source: "cake_request",
      customerName: MALICIOUS_NAME,
      referenceCode: "FP-2-A7K2",
      celebrationDate: "2026-02-01",
      summaryLines: ["Celebración: Cumpleaños"],
    });

    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;Ana");
  });

  it("escapa HTML dentro de las líneas de resumen (ej. descripción libre)", () => {
    const email = buildCustomerConfirmationEmail({
      source: "cake_request",
      customerName: "Ana",
      referenceCode: "FP-2-A7K2",
      celebrationDate: "2026-02-01",
      summaryLines: ['Descripción: <script>alert("hi")</script>'],
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("no interpola el nombre del cliente en el asunto", () => {
    const email = buildCustomerConfirmationEmail({
      source: "cake_request",
      customerName: MALICIOUS_NAME,
      referenceCode: "FP-2-A7K2",
      celebrationDate: "2026-02-01",
      summaryLines: [],
    });

    expect(email.subject).not.toContain(MALICIOUS_NAME);
    expect(email.subject).toContain("FP-2-A7K2");
  });

  it("genera una versión en texto plano equivalente", () => {
    const email = buildCustomerConfirmationEmail({
      source: "cake_design",
      customerName: "Ana",
      referenceCode: "FP-3-2WRZ",
      celebrationDate: "2026-02-01",
      summaryLines: ["Torta de un piso"],
    });

    expect(email.text).toContain("FP-3-2WRZ");
    expect(email.text).toContain("Torta de un piso");
    expect(email.text).not.toContain("<");
  });
});

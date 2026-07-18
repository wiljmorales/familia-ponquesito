import { describe, expect, it } from "vitest";
import { buildReservationCustomerEmail } from "./reservation-customer";

const BASE = {
  customerName: "Ana Pérez",
  code: "FP-8-ABCD",
  celebrationDate: "2026-08-15",
  summaryLines: ["Torta de chocolate para 20 personas"],
  manageUrl:
    "https://familia-ponquesito.vercel.app/agenda/reservas/FP-8-ABCD?token=secreto",
};

describe("buildReservationCustomerEmail", () => {
  it("pending_deposit incluye código, fecha, anticipo, próximos pasos y enlace", () => {
    const email = buildReservationCustomerEmail({
      ...BASE,
      status: "pending_deposit",
    });

    for (const content of [email.html, email.text]) {
      expect(content).toContain("FP-8-ABCD");
      expect(content).toContain("15 de agosto de 2026");
      expect(content).toContain("50");
      expect(content).toContain(BASE.manageUrl.replace("&", "&amp;").split("&amp;")[0]);
      expect(content).not.toMatch(/pedido confirmado/i);
    }
  });

  it("human_review deja claro que la fecha preferida no quedó reservada", () => {
    const email = buildReservationCustomerEmail({
      ...BASE,
      status: "human_review",
    });

    expect(email.html).toContain("todavía no está reservada");
    expect(email.text).toContain("todavía no está reservada");
    expect(`${email.subject} ${email.html} ${email.text}`).not.toMatch(
      /fecha reservada|pedido confirmado|último cupo apartado/i,
    );
  });

  it("escapa todo contenido dinámico en HTML y conserva texto plano", () => {
    const email = buildReservationCustomerEmail({
      ...BASE,
      status: "pending_deposit",
      customerName: "<script>Ana</script>",
      code: 'FP-8-<img src=x onerror="x">',
      summaryLines: ["Tema: <b>malicioso</b>"],
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("<b>malicioso</b>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain("<script>Ana</script>");
    expect(email.text).not.toContain("<div");
  });
});

import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escape";

describe("escapeHtml", () => {
  it("escapa etiquetas HTML", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapa comillas dobles y simples (contexto de atributos)", () => {
    expect(escapeHtml(`"onmouseover='alert(1)'`)).toBe(
      "&quot;onmouseover=&#39;alert(1)&#39;",
    );
  });

  it("escapa ampersands", () => {
    expect(escapeHtml("Tortas & Postres")).toBe("Tortas &amp; Postres");
  });

  it("deja intacto el texto sin caracteres especiales", () => {
    expect(escapeHtml("Torta de chocolate")).toBe("Torta de chocolate");
  });
});

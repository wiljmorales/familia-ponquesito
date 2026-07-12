import { describe, expect, it, vi } from "vitest";
import { AssistantProviderError } from "@/providers/gemini";

/* Simula fallos del proveedor para verificar que el endpoint responde con
   mensajes amables y sin detalles técnicos. */

const mocks = vi.hoisted(() => ({
  askAssistant: vi.fn(),
}));

vi.mock("@/assistant/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/assistant/service")>();
  return { ...actual, askAssistant: mocks.askAssistant };
});

import { POST } from "./route";

function makeRequest() {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hola" }),
  });
}

describe("POST /api/assistant — fallos del proveedor", () => {
  it("responde 429 con mensaje amable ante error de cuota", async () => {
    mocks.askAssistant.mockRejectedValueOnce(
      new AssistantProviderError("Cuota del proveedor agotada", "quota"),
    );
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);

    const data = await response.json();
    expect(data.error).toContain("Espera unos minutos");
    expect(data.error).not.toMatch(/429|quota|api|gemini/i);
  });

  it.each(["network", "timeout", "unavailable"] as const)(
    "responde 503 con mensaje amable ante error %s",
    async (kind) => {
      mocks.askAssistant.mockRejectedValueOnce(
        new AssistantProviderError("detalle técnico interno", kind),
      );
      const response = await POST(makeRequest());
      expect(response.status).toBe(503);

      const data = await response.json();
      expect(typeof data.error).toBe("string");
      expect(data.error).not.toContain("detalle técnico interno");
    },
  );

  it("responde 500 ante errores inesperados", async () => {
    mocks.askAssistant.mockRejectedValueOnce(new Error("boom interno"));
    const response = await POST(makeRequest());
    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data.error).not.toContain("boom interno");
  });
});

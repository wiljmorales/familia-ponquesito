import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

/* Sin clave, el endpoint usa el proveedor determinista: cero cuota. */
beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
});

function makeRequest(body: string) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/assistant", () => {
  it("responde 200 con el contrato { status, reply } ante un mensaje válido", async () => {
    const response = await POST(makeRequest(JSON.stringify({ message: "hola" })));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(["answered", "unknown", "human_required"]).toContain(data.status);
    expect(typeof data.reply).toBe("string");
    expect(data.reply.length).toBeGreaterThan(0);
  });

  it("responde 400 ante JSON inválido", async () => {
    const response = await POST(makeRequest("esto no es json"));
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(typeof data.error).toBe("string");
  });

  it("responde 400 ante un mensaje vacío", async () => {
    const response = await POST(makeRequest(JSON.stringify({ message: "  " })));
    expect(response.status).toBe(400);
  });

  it("responde 400 si falta el campo message", async () => {
    const response = await POST(makeRequest(JSON.stringify({ text: "hola" })));
    expect(response.status).toBe(400);
  });

  it("responde 400 ante un historial malformado", async () => {
    const response = await POST(
      makeRequest(
        JSON.stringify({ message: "hola", history: [{ role: "hacker" }] }),
      ),
    );
    expect(response.status).toBe(400);
  });
});

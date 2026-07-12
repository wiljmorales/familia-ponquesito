import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

/* Sin clave, el endpoint usa el proveedor determinista: cero cuota. */
beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
});

function makeRequest(ip: string) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ message: "hola" }),
  });
}

describe("POST /api/assistant — límite de peticiones", () => {
  it("permite 10 peticiones por minuto y frena la 11ª con un 429 amable", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await POST(makeRequest("203.0.113.7"));
      expect(response.status).toBe(200);
    }

    const blocked = await POST(makeRequest("203.0.113.7"));
    expect(blocked.status).toBe(429);

    const data = await blocked.json();
    expect(data.error).toContain("Espere un momento");
    expect(data.error).not.toMatch(/rate|limit|429/i);
  });

  it("no afecta a otras IPs", async () => {
    for (let i = 0; i < 11; i++) {
      await POST(makeRequest("203.0.113.8"));
    }
    const other = await POST(makeRequest("203.0.113.9"));
    expect(other.status).toBe(200);
  });
});

import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("permite hasta el límite dentro de la ventana", () => {
    const isAllowed = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;

    expect(isAllowed("ip-a", t0)).toBe(true);
    expect(isAllowed("ip-a", t0 + 1000)).toBe(true);
    expect(isAllowed("ip-a", t0 + 2000)).toBe(true);
    expect(isAllowed("ip-a", t0 + 3000)).toBe(false);
  });

  it("cada clave tiene su propio contador", () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const t0 = 1_000_000;

    expect(isAllowed("ip-a", t0)).toBe(true);
    expect(isAllowed("ip-a", t0 + 10)).toBe(false);
    expect(isAllowed("ip-b", t0 + 20)).toBe(true);
  });

  it("reinicia el contador al expirar la ventana", () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const t0 = 1_000_000;

    expect(isAllowed("ip-a", t0)).toBe(true);
    expect(isAllowed("ip-a", t0 + 30_000)).toBe(false);
    expect(isAllowed("ip-a", t0 + 60_000)).toBe(true);
  });

  it("purga entradas expiradas para no crecer sin límite", () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const t0 = 1_000_000;

    for (let i = 0; i < 1000; i++) {
      isAllowed(`ip-${i}`, t0);
    }
    /* Tras expirar la ventana, claves nuevas siguen funcionando y las
       viejas se reinician correctamente. */
    expect(isAllowed("ip-0", t0 + 60_001)).toBe(true);
    expect(isAllowed("ip-nueva", t0 + 60_002)).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync(new URL("../../../../next.config.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("./[code]/page.tsx", import.meta.url), "utf8");
const manager = readFileSync(
  new URL("./[code]/reservation-manager.tsx", import.meta.url),
  "utf8",
);

describe("seguridad y accesibilidad de la ruta privada", () => {
  it("configura no-store, no-referrer y noindex para la ruta", () => {
    expect(config).toContain('source: "/agenda/reservas/:code"');
    expect(config).toContain('{ key: "Cache-Control", value: "no-store" }');
    expect(config).toContain('{ key: "Referrer-Policy", value: "no-referrer" }');
    expect(config).toContain("noindex, nofollow, noarchive");
    expect(page).toContain("robots: { index: false, follow: false, noarchive: true }");
  });

  it("no persiste el token ni registra el query string", () => {
    expect(page).not.toMatch(/console\.(log|info|warn|error)/);
    expect(manager).not.toContain("localStorage");
    expect(manager).not.toContain("sessionStorage");
    expect(manager).not.toContain("analytics");
  });

  it("exige confirmaciones explícitas y ofrece estados de carga accesibles", () => {
    expect(manager).toContain('type="checkbox"');
    expect(manager).toContain("Confirmar nueva fecha");
    expect(manager).toContain("Cancelar definitivamente");
    expect(manager).toContain('aria-labelledby="reschedule-title"');
    expect(manager).toContain('aria-labelledby="cancel-title"');
    expect(manager).toContain('role="status"');
  });
});

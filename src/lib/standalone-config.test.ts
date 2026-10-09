import { afterEach, describe, expect, it, vi } from "vitest";

// El servidor standalone es solo para el VPS (deploy/web/build-artifact.sh).
// Vercel debe seguir compilando sin `output`, igual que antes.
async function loadConfig() {
  vi.resetModules();
  return (await import("../../next.config")).default;
}

describe("output standalone de next.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no se activa por defecto (Vercel)", async () => {
    vi.stubEnv("PONQUESITO_STANDALONE", "");
    expect((await loadConfig()).output).toBeUndefined();
  });

  it("se activa con PONQUESITO_STANDALONE=1", async () => {
    vi.stubEnv("PONQUESITO_STANDALONE", "1");
    expect((await loadConfig()).output).toBe("standalone");
  });
});

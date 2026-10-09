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
    vi.stubEnv("APP_CANONICAL_URL", "https://staging.example.test");
    expect((await loadConfig()).output).toBe("standalone");
  });

  it("el build standalone exige APP_CANONICAL_URL", async () => {
    vi.stubEnv("PONQUESITO_STANDALONE", "1");
    vi.stubEnv("APP_CANONICAL_URL", "");
    await expect(loadConfig()).rejects.toThrow("APP_CANONICAL_URL");
  });

  it("Vercel no necesita APP_CANONICAL_URL", async () => {
    vi.stubEnv("PONQUESITO_STANDALONE", "");
    vi.stubEnv("APP_CANONICAL_URL", "");
    expect((await loadConfig()).output).toBeUndefined();
  });
});

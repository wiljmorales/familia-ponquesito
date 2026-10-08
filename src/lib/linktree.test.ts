import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// /linktree está impresa en códigos QR: si deja de existir, los QR fallan.
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const sha256 = (file: string) =>
  createHash("sha256").update(readFileSync(path.join(PUBLIC_DIR, file))).digest("hex");

describe("página de enlaces en /linktree", () => {
  it("/linktree se reescribe a la página estática", async () => {
    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toContainEqual({ source: "/linktree", destination: "/linktree.html" });
  });

  it("conserva el HTML y los recursos capturados del sitio original", () => {
    // SHA-256 de la reconstrucción (docs/linktree.md).
    expect(sha256("linktree.html")).toBe(
      "08bc2086448435b0f0ebab93e63211104f8af2bee3fad2238968ce2eb01ab70c",
    );
    expect(sha256("favicon.svg")).toBe(
      "70ee414ee6cf4ed1d967d0fd69fb0ae0c24b2488f9c38f5034a7f813330e6e85",
    );
    expect(sha256("assets/logo-familia-ponquesito.png")).toBe(
      "09e6a7bf0198b1207cd332f7774af6d0016f13a6ba8a2321451046c025f7fcbe",
    );
  });

  it("los recursos se referencian con rutas que resuelven desde /linktree", () => {
    const html = readFileSync(path.join(PUBLIC_DIR, "linktree.html"), "utf8");
    expect(html).toContain('href="./favicon.svg"');
    expect(html).toContain('src="./assets/logo-familia-ponquesito.png"');
  });
});

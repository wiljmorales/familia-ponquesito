// Solo para deploy/staging/probar-correo.sh y test/https/probar-sim.sh: código de
// la app contra el SMTP de pruebas de Preview. No forma parte de npm test.
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const shim = (name: string) => fileURLToPath(new URL(`./shims/${name}`, import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: shim("server-only.mjs") },
      { find: /^next\/server$/, replacement: shim("next-server.mjs") },
      { find: /^next\/headers$/, replacement: shim("next-headers.mjs") },
    ],
  },
  test: {
    environment: "node",
    include: ["deploy/staging/test/*.smtp.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});

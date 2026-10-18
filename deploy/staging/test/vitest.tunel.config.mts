// Solo para deploy/staging/probar-tunel.sh: flujos reales de Next.js contra el
// backend de staging por túnel SSH. No forma parte de npm test.
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
    include: ["deploy/staging/test/*.e2e.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});

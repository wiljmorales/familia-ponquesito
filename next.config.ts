import type { NextConfig } from "next";

const standalone = process.env.PONQUESITO_STANDALONE === "1";

// En el VPS no hay URL por defecto razonable: sin APP_CANONICAL_URL, el
// metadata y los enlaces de correo apuntarían a producción en Vercel.
if (standalone && !process.env.APP_CANONICAL_URL?.trim()) {
  throw new Error("El build standalone (VPS) requiere APP_CANONICAL_URL.");
}

const nextConfig: NextConfig = {
  // Servidor autónomo (.next/standalone) para el VPS. Solo lo activa
  // deploy/web/build-artifact.sh; Vercel compila sin esta opción, igual que antes.
  output: standalone ? "standalone" : undefined,
  async rewrites() {
    return [
      // Página de enlaces (reconstrucción byte a byte de la de ChatGPT Sites).
      // /linktree es permanente: está impresa en códigos QR. Ver docs/linktree.md.
      { source: "/linktree", destination: "/linktree.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/agenda/reservas/:code",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;

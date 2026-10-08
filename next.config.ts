import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

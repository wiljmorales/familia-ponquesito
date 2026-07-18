/**
 * URL pública canónica de la aplicación. Única fuente de verdad: la usan
 * el metadata del layout y la construcción de enlaces en correos (Reto 8).
 * Los enlaces sensibles JAMÁS se construyen desde headers del request
 * (Host/Origin son controlables por el cliente).
 *
 * APP_CANONICAL_URL permite que una Preview controlada genere enlaces hacia
 * su alias estable. Si no se configura, se usa producción. Nunca se infiere
 * desde VERCEL_URL, Host, Origin ni headers del request.
 */
const PRODUCTION_SITE_URL = "https://familia-ponquesito.vercel.app";

export function canonicalSiteUrl(configured = process.env.APP_CANONICAL_URL): string {
  const value = configured?.trim() || PRODUCTION_SITE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_CANONICAL_URL debe ser una URL HTTPS explícita.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_CANONICAL_URL debe ser un origen HTTPS sin ruta ni credenciales.");
  }
  return url.origin;
}

export const SITE_URL = canonicalSiteUrl();

/** URL absoluta a partir de una ruta interna ("/agenda/reservas/..."). */
export function absoluteUrl(path: string): string {
  const trimmed = path.trim();
  if (
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("\\\\") ||
    trimmed.includes("\\")
  ) {
    throw new Error("Solo se permiten rutas internas.");
  }

  const internalPath = `/${trimmed.replace(/^\/+/, "")}`;
  return new URL(internalPath, SITE_URL).toString();
}

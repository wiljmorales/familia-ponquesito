/**
 * URL pública canónica de la aplicación. Única fuente de verdad: la usan
 * el metadata del layout y la construcción de enlaces en correos (Reto 8).
 * Los enlaces sensibles JAMÁS se construyen desde headers del request
 * (Host/Origin son controlables por el cliente).
 *
 * Decisión deliberada: previews y entornos locales también generan enlaces
 * hacia producción. Así un correo nunca apunta a un host efímero o interno.
 */
export const SITE_URL = "https://familia-ponquesito.vercel.app";

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

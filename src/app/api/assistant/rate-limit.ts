/**
 * Limitador de peticiones en memoria (ventana fija por clave/IP).
 *
 * Protección básica de la cuota gratuita de Gemini: un usuario real
 * conversando no supera el límite; un script en bucle sí, y se frena antes
 * de tocar la cuota. Limitación conocida y aceptada: en serverless cada
 * instancia tiene su propia memoria, así que el límite no es global entre
 * instancias (ver docs/decisions.md).
 */

interface RateLimiterOptions {
  /** Peticiones permitidas por ventana. */
  limit: number;
  /** Duración de la ventana en milisegundos. */
  windowMs: number;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

/** Tamaño a partir del cual se purgan las entradas expiradas. */
const PRUNE_THRESHOLD = 1000;

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  const hits = new Map<string, WindowEntry>();

  function prune(now: number) {
    for (const [key, entry] of hits) {
      if (now - entry.windowStart >= windowMs) {
        hits.delete(key);
      }
    }
  }

  return function isAllowed(key: string, now = Date.now()): boolean {
    const entry = hits.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      if (hits.size >= PRUNE_THRESHOLD) {
        prune(now);
      }
      hits.set(key, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    return entry.count <= limit;
  };
}

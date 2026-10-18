// Petición simulada: IP de documentación (TEST-NET-3), nunca una real.
export async function headers() {
  return new Headers({ "x-forwarded-for": "203.0.113.7" });
}

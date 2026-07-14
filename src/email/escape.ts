/**
 * Escapa texto aportado por el cliente antes de insertarlo en HTML de
 * correo (nombre, descripción, mensaje de la placa, etc.). Cubre también
 * comillas porque el mismo escape se reutiliza para valores dentro de
 * atributos (ej. href de la imagen de referencia).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Persistencia del prototipo (Reto 5) en sessionStorage, bajo una clave
 * versionada y exclusiva del Reto 5 (no toca nada de otros módulos).
 *
 * Solo se guarda lo que no puede reconstruirse: los cambios de estado de
 * los pedidos respecto a los datos iniciales (statusOverrides). Pantalla,
 * filtro y cotización se regeneran al recargar. Todo es defensivo: JSON
 * corrupto, versión desconocida, estados inválidos o un storage que lanza
 * (modo privado, cuota) nunca rompen la demo.
 *
 * Las funciones reciben el storage como parámetro (StorageLike) para poder
 * probarlas en node con un doble; el orquestador cliente les pasa
 * window.sessionStorage.
 */

import { ORDER_STATUSES, type OrderStatus, type PrototypeOrder } from "@/types/prototype";
import { createPrototypeOrders } from "@/data/prototype-orders";

export const PROTOTYPE_STORAGE_KEY = "familia-ponquesito:prototype:v1";

const STORAGE_VERSION = 1;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Lee los cambios de estado guardados. Devuelve null si no hay nada
 * guardado o si lo guardado no es utilizable (nunca lanza).
 */
export function loadStatusOverrides(
  storage: StorageLike,
): Record<string, OrderStatus> | null {
  try {
    const raw = storage.getItem(PROTOTYPE_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (record.version !== STORAGE_VERSION) return null;
    if (typeof record.statusOverrides !== "object" || record.statusOverrides === null) {
      return null;
    }

    const overrides: Record<string, OrderStatus> = {};
    for (const [id, status] of Object.entries(record.statusOverrides)) {
      if (isOrderStatus(status)) overrides[id] = status;
    }
    return overrides;
  } catch {
    return null;
  }
}

/** Guarda los cambios de estado; con un objeto vacío limpia la clave. */
export function saveStatusOverrides(
  storage: StorageLike,
  overrides: Record<string, OrderStatus>,
): void {
  try {
    if (Object.keys(overrides).length === 0) {
      storage.removeItem(PROTOTYPE_STORAGE_KEY);
      return;
    }
    storage.setItem(
      PROTOTYPE_STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, statusOverrides: overrides }),
    );
  } catch {
    // Sin persistencia la demo sigue funcionando; no hay nada que romper.
  }
}

/** Borra el estado guardado (botón "Reiniciar demo"). */
export function clearPrototypeStorage(storage: StorageLike): void {
  try {
    storage.removeItem(PROTOTYPE_STORAGE_KEY);
  } catch {
    // Ídem: fallar en silencio es el comportamiento deseado.
  }
}

/**
 * Calcula qué pedidos cambiaron de estado respecto a los datos iniciales
 * de la misma fecha base. Es lo único que vale la pena persistir.
 */
export function diffStatusOverrides(
  baseDate: string,
  orders: PrototypeOrder[],
): Record<string, OrderStatus> {
  const initialByOrderId = new Map(
    createPrototypeOrders(baseDate).map((order) => [order.id, order.status]),
  );

  const overrides: Record<string, OrderStatus> = {};
  for (const order of orders) {
    const initialStatus = initialByOrderId.get(order.id);
    if (initialStatus !== undefined && initialStatus !== order.status) {
      overrides[order.id] = order.status;
    }
  }
  return overrides;
}

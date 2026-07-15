import { describe, expect, it } from "vitest";
import { createPrototypeOrders } from "@/data/prototype-orders";
import type { OrderStatus } from "@/types/prototype";
import {
  clearPrototypeStorage,
  diffStatusOverrides,
  loadStatusOverrides,
  PROTOTYPE_STORAGE_KEY,
  saveStatusOverrides,
  type StorageLike,
} from "./storage";

const BASE_DATE = "2026-03-10";

/** Doble de sessionStorage sobre un Map, suficiente para el contrato usado. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** Storage que lanza en cada operación (modo privado, cuota llena). */
const THROWING_STORAGE: StorageLike = {
  getItem: () => {
    throw new Error("storage bloqueado");
  },
  setItem: () => {
    throw new Error("storage lleno");
  },
  removeItem: () => {
    throw new Error("storage bloqueado");
  },
};

describe("save + load", () => {
  it("guarda y recupera los overrides", () => {
    const storage = fakeStorage();
    saveStatusOverrides(storage, { "PED-001": "waiting_deposit" });
    expect(loadStatusOverrides(storage)).toEqual({ "PED-001": "waiting_deposit" });
  });

  it("guardar un objeto vacío limpia la clave", () => {
    const storage = fakeStorage();
    saveStatusOverrides(storage, { "PED-001": "waiting_deposit" });
    saveStatusOverrides(storage, {});
    expect(storage.data.has(PROTOTYPE_STORAGE_KEY)).toBe(false);
    expect(loadStatusOverrides(storage)).toBeNull();
  });
});

describe("loadStatusOverrides: entradas defensivas", () => {
  it("devuelve null cuando no hay nada guardado", () => {
    expect(loadStatusOverrides(fakeStorage())).toBeNull();
  });

  it("descarta JSON corrupto sin lanzar", () => {
    const storage = fakeStorage({ [PROTOTYPE_STORAGE_KEY]: "{corrupto!!" });
    expect(loadStatusOverrides(storage)).toBeNull();
  });

  it("descarta versiones desconocidas", () => {
    const storage = fakeStorage({
      [PROTOTYPE_STORAGE_KEY]: JSON.stringify({
        version: 2,
        statusOverrides: { "PED-001": "confirmed" },
      }),
    });
    expect(loadStatusOverrides(storage)).toBeNull();
  });

  it("descarta formas inesperadas (array, null, sin statusOverrides)", () => {
    for (const raw of ["[1,2]", "null", '"texto"', JSON.stringify({ version: 1 })]) {
      const storage = fakeStorage({ [PROTOTYPE_STORAGE_KEY]: raw });
      expect(loadStatusOverrides(storage)).toBeNull();
    }
  });

  it("filtra estados que no existen y conserva los válidos", () => {
    const storage = fakeStorage({
      [PROTOTYPE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        statusOverrides: {
          "PED-001": "waiting_deposit",
          "PED-002": "estado-falso",
          "PED-003": 42,
        },
      }),
    });
    expect(loadStatusOverrides(storage)).toEqual({ "PED-001": "waiting_deposit" });
  });

  it("sobrevive a un storage que lanza", () => {
    expect(loadStatusOverrides(THROWING_STORAGE)).toBeNull();
    expect(() =>
      saveStatusOverrides(THROWING_STORAGE, { "PED-001": "confirmed" }),
    ).not.toThrow();
    expect(() => clearPrototypeStorage(THROWING_STORAGE)).not.toThrow();
  });
});

describe("clearPrototypeStorage", () => {
  it("borra el estado guardado (Reiniciar demo)", () => {
    const storage = fakeStorage();
    saveStatusOverrides(storage, { "PED-001": "waiting_deposit" });
    clearPrototypeStorage(storage);
    expect(loadStatusOverrides(storage)).toBeNull();
  });
});

describe("diffStatusOverrides", () => {
  it("devuelve solo los pedidos cuyo estado cambió", () => {
    const orders = createPrototypeOrders(BASE_DATE).map((order) =>
      order.id === "PED-001" ? { ...order, status: "waiting_deposit" as OrderStatus } : order,
    );
    expect(diffStatusOverrides(BASE_DATE, orders)).toEqual({
      "PED-001": "waiting_deposit",
    });
  });

  it("sin cambios devuelve un objeto vacío", () => {
    expect(diffStatusOverrides(BASE_DATE, createPrototypeOrders(BASE_DATE))).toEqual({});
  });
});

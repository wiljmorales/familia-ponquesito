import { describe, expect, it } from "vitest";
import {
  CELEBRATION_TYPES,
  FLAVORS,
  MAX_GUEST_COUNT,
  MIN_LEAD_DAYS,
} from "@/lib/constants/business";
import { daysBetweenISO } from "@/lib/business-dates";
import { ORDER_STATUSES } from "@/types/prototype";
import { createPrototypeOrders, DEMO_PHONE } from "./prototype-orders";

// Fecha base fija: las pruebas nunca dependen del reloj real.
const BASE_DATE = "2026-03-10";

describe("createPrototypeOrders", () => {
  const orders = createPrototypeOrders(BASE_DATE);

  it("genera cinco pedidos con ids únicos", () => {
    expect(orders).toHaveLength(5);
    expect(new Set(orders.map((order) => order.id)).size).toBe(5);
  });

  it("cubre los cinco estados del pedido, uno por pedido", () => {
    expect(new Set(orders.map((order) => order.status))).toEqual(new Set(ORDER_STATUSES));
  });

  it("marca exactamente un pedido para el flujo de la demo y llega como nuevo", () => {
    const demoFlow = orders.filter((order) => order.isDemoFlowOrder);
    expect(demoFlow).toHaveLength(1);
    expect(demoFlow[0].status).toBe("new");
    expect(demoFlow[0].receivedDate).toBe(BASE_DATE);
  });

  it("todas las celebraciones respetan la anticipación mínima del negocio", () => {
    for (const order of orders) {
      expect(daysBetweenISO(BASE_DATE, order.celebrationDate)).toBeGreaterThanOrEqual(
        MIN_LEAD_DAYS,
      );
    }
  });

  it("las solicitudes llegaron en o antes de la fecha base", () => {
    for (const order of orders) {
      expect(order.receivedDate <= BASE_DATE).toBe(true);
    }
  });

  it("usa solo el contacto de demostración, nunca datos reales", () => {
    for (const order of orders) {
      expect(order.whatsapp).toBe(DEMO_PHONE);
    }
  });

  it("usa solo sabores y celebraciones reales del negocio", () => {
    const flavorLabels = FLAVORS.map((flavor) => flavor.label);
    const celebrationLabels = CELEBRATION_TYPES.map((type) => type.label);
    for (const order of orders) {
      expect(flavorLabels).toContain(order.flavor);
      expect(celebrationLabels).toContain(order.celebrationType);
    }
  });

  it("mantiene cantidades de invitados plausibles", () => {
    for (const order of orders) {
      expect(order.guestCount).toBeGreaterThan(0);
      expect(order.guestCount).toBeLessThanOrEqual(MAX_GUEST_COUNT);
    }
  });

  it("solo los pedidos con delivery tienen zona", () => {
    for (const order of orders) {
      if (order.deliveryMethod === "delivery") {
        expect(order.zone).toBeTruthy();
      } else {
        expect(order.zone).toBeNull();
      }
    }
  });

  it("es determinista para una misma fecha base", () => {
    expect(createPrototypeOrders(BASE_DATE)).toEqual(orders);
  });
});

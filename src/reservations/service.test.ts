import { beforeEach, describe, expect, it, vi } from "vitest";

// service.ts (y sus dependencias) importan "server-only"; en Vitest no hay
// runtime de React Server Components, así que se anula el paquete.
vi.mock("server-only", () => ({}));

import {
  cancelReservation,
  createReservation,
  getAvailability,
  lookupReservation,
  rescheduleReservation,
  type CreateReservationInput,
  type ReservationServiceDeps,
} from "./service";
import { hashManageToken } from "./token";

function baseInput(): CreateReservationInput {
  return {
    celebrationDate: "2026-08-10",
    capacityPoints: 2,
    status: "pending_deposit",
    customerName: "Ana Pérez",
    customerEmail: "ana@example.com",
    customerPhone: "+58 412 0000000",
    guestCount: 25,
    flavor: "Chocolate",
    theme: "Safari",
    fulfillmentType: "pickup",
    orderDetails: { complexity: "custom", reasons: ["Decoración personalizada o temática."] },
  };
}

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

function fakeSupabase(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const calls: RpcCall[] = [];
  let index = 0;
  const operationMap: Record<string, string> = {
    "agenda-reserve": "reserve_production_slot", "agenda-availability": "get_production_availability",
    "agenda-lookup": "get_cake_reservation", "agenda-reschedule": "reschedule_cake_reservation",
    "agenda-cancel": "cancel_cake_reservation",
  };
  const post = vi.fn(async (operation: string, payload: Record<string, unknown> | FormData) => {
      const params = Object.fromEntries(Object.entries(payload).map(([key, value]) => [
        key === "code" ? "p_code" : key === "token_hash" || key === "manage_token_hash" ? "p_manage_token_hash" :
        key === "start_date" ? "p_start_date" : key === "end_date" ? "p_end_date" :
        key === "new_date" ? "p_new_date" : `p_${key}`,
        value,
      ]));
      calls.push({ fn: operationMap[operation], params });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response.error) throw new Error(response.error.message);
      if (operation === "agenda-availability") return { ok: true, days: response.data };
      return response.data;
  });
  return { post: post as unknown as NonNullable<ReservationServiceDeps["post"]>, calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createReservation", () => {
  it("reserva con éxito: genera código FP-8 y devuelve el token en claro", async () => {
    const { post, calls } = fakeSupabase([
      {
        data: {
          ok: true,
          reservation_id: "res-1",
          code: "FP-8-TEST",
          status: "pending_deposit",
          capacity_total: 4,
          capacity_used: 2,
          capacity_remaining: 2,
        },
      },
    ]);

    const result = await createReservation(baseInput(), { post });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe("res-1");
      expect(result.capacityTotal).toBe(4);
      expect(result.capacityUsed).toBe(2);
      expect(result.capacityRemaining).toBe(2);
      expect(result.status).toBe("pending_deposit");
      // El token en claro se devuelve al llamador; a la base de datos solo
      // viajó su hash SHA-256.
      expect(hashManageToken(result.manageToken)).toBe(calls[0].params.p_manage_token_hash);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("reserve_production_slot");
    expect(calls[0].params.p_code).toMatch(/^FP-8-[2-9A-HJKMNP-Z]{4}$/);
    expect(calls[0].params.p_capacity_points).toBe(2);
    expect(calls[0].params.p_manage_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("propaga capacity_unavailable sin reintentar", async () => {
    const { post, calls } = fakeSupabase([
      { data: { ok: false, error: "capacity_unavailable", capacity_remaining: 1 } },
    ]);

    const result = await createReservation(baseInput(), { post });

    expect(result).toEqual({ ok: false, error: "capacity_unavailable" });
    expect(calls).toHaveLength(1);
  });

  it("reintenta con otro código cuando el RPC devuelve code_taken", async () => {
    const { post, calls } = fakeSupabase([
      { data: { ok: false, error: "code_taken" } },
      {
        data: {
          ok: true,
          reservation_id: "res-2",
          code: "FP-8-OTRO",
          status: "pending_deposit",
          capacity_total: 4,
          capacity_used: 4,
          capacity_remaining: 0,
        },
      },
    ]);

    const result = await createReservation(baseInput(), { post });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // Ambos intentos usan el MISMO hash de token: solo cambia el código.
    expect(calls[0].params.p_manage_token_hash).toBe(calls[1].params.p_manage_token_hash);
  });

  it("se rinde tras 5 colisiones de código", async () => {
    const { post, calls } = fakeSupabase([{ data: { ok: false, error: "code_taken" } }]);

    const result = await createReservation(baseInput(), { post });

    expect(result).toEqual({ ok: false, error: "code_taken" });
    expect(calls).toHaveLength(5);
  });

  it("devuelve service_unavailable ante un fallo de transporte, sin filtrar detalles", async () => {
    const { post } = fakeSupabase([{ data: null, error: { message: "boom" } }]);

    const result = await createReservation(baseInput(), { post });

    expect(result).toEqual({ ok: false, error: "service_unavailable" });
  });
});

describe("getAvailability", () => {
  it("devuelve las filas del RPC tal cual (PostgreSQL es la autoridad)", async () => {
    const rows = [
      {
        business_date: "2026-08-10",
        capacity_total: 4,
        capacity_used: 2,
        capacity_remaining: 2,
        is_blocked: false,
        can_accept: true,
      },
    ];
    const { post, calls } = fakeSupabase([{ data: rows }]);

    const result = await getAvailability("2026-08-01", "2026-08-31", 2, { post });

    expect(result).toEqual({ ok: true, days: rows });
    expect(calls[0].fn).toBe("get_production_availability");
    expect(calls[0].params).toEqual({
      p_start_date: "2026-08-01",
      p_end_date: "2026-08-31",
      p_capacity_points: 2,
    });
  });

  it("devuelve service_unavailable si el RPC falla", async () => {
    const { post } = fakeSupabase([{ data: null, error: { message: "boom" } }]);
    const result = await getAvailability("2026-08-01", "2026-08-31", 1, { post });
    expect(result).toEqual({ ok: false, error: "service_unavailable" });
  });
});

describe("lookupReservation", () => {
  it("envía solo código y hash, y devuelve una proyección pública cerrada", async () => {
    const { post, calls } = fakeSupabase([
      {
        data: {
          ok: true,
          reservation: {
            code: "FP-8-TEST",
            celebration_date: "2026-08-10",
            status: "pending_deposit",
            customer_name: "Ana Pérez",
            guest_count: 20,
            flavor: "Chocolate",
            theme: "Flores",
            fulfillment_type: "pickup",
            delivery_details: null,
            created_at: "2026-07-18T12:00:00Z",
            capacity_points: 2,
            can_reschedule: true,
            can_cancel: true,
            reschedule_reason: null,
            cancellation_reason: null,
            manage_token_hash: "no debe salir",
            order_details: { private: true },
          },
        },
      },
    ]);

    const result = await lookupReservation("FP-8-TEST", "token-claro", { post });

    expect(calls[0]).toEqual({
      fn: "get_cake_reservation",
      params: {
        p_code: "FP-8-TEST",
        p_manage_token_hash: hashManageToken("token-claro"),
      },
    });
    expect(JSON.stringify(result)).not.toContain("token-claro");
    expect(JSON.stringify(result)).not.toContain("manage_token_hash");
    expect(JSON.stringify(result)).not.toContain("order_details");
    expect(result).toMatchObject({
      ok: true,
      reservation: { code: "FP-8-TEST", capacityPoints: 2, canCancel: true },
    });
  });

  it("ofrece la misma respuesta para código o token incorrectos", async () => {
    const response = { data: { ok: false, error: "reservation_not_found" } };
    const first = fakeSupabase([response]);
    const second = fakeSupabase([response]);

    await expect(
      lookupReservation("FP-8-NOPE", "token-valido", { post: first.post }),
    ).resolves.toEqual({ ok: false, error: "reservation_not_found" });
    await expect(
      lookupReservation("FP-8-TEST", "token-malo", { post: second.post }),
    ).resolves.toEqual({ ok: false, error: "reservation_not_found" });
  });
});

describe("rescheduleReservation", () => {
  it("envía el hash del token (nunca el token) y mapea la respuesta", async () => {
    const { post, calls } = fakeSupabase([
      {
        data: {
          ok: true,
          reservation_id: "res-1",
          code: "FP-8-TEST",
          status: "confirmed",
          previous_date: "2026-08-10",
          new_date: "2026-08-12",
        },
      },
    ]);

    const result = await rescheduleReservation("FP-8-TEST", "token-claro", "2026-08-12", {
      post,
    });

    expect(calls[0].fn).toBe("reschedule_cake_reservation");
    expect(calls[0].params.p_manage_token_hash).toBe(hashManageToken("token-claro"));
    expect(calls[0].params).not.toHaveProperty("p_manage_token");
    expect(result).toMatchObject({
      ok: true,
      code: "FP-8-TEST",
      status: "confirmed",
      previousDate: "2026-08-10",
      newDate: "2026-08-12",
    });
  });

  it("propaga los códigos de error del RPC", async () => {
    const { post } = fakeSupabase([
      { data: { ok: false, error: "change_window_closed" } },
    ]);
    const result = await rescheduleReservation("FP-8-TEST", "token", "2026-08-12", { post });
    expect(result).toEqual({ ok: false, error: "change_window_closed" });
  });
});

describe("cancelReservation", () => {
  it("cancela y mapea la respuesta", async () => {
    const { post, calls } = fakeSupabase([
      {
        data: {
          ok: true,
          reservation_id: "res-1",
          code: "FP-8-TEST",
          status: "cancelled",
          celebration_date: "2026-08-10",
        },
      },
    ]);

    const result = await cancelReservation("FP-8-TEST", "token-claro", { post });

    expect(calls[0].fn).toBe("cancel_cake_reservation");
    expect(calls[0].params.p_manage_token_hash).toBe(hashManageToken("token-claro"));
    expect(result).toMatchObject({ ok: true, status: "cancelled", celebrationDate: "2026-08-10" });
  });

  it("devuelve el mismo error para código o token inválidos (anti-enumeración)", async () => {
    const { post } = fakeSupabase([
      { data: { ok: false, error: "reservation_not_found" } },
    ]);
    const result = await cancelReservation("FP-8-XXXX", "token-malo", { post });
    expect(result).toEqual({ ok: false, error: "reservation_not_found" });
  });
});

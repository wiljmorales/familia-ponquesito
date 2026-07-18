import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// service.ts (y sus dependencias) importan "server-only"; en Vitest no hay
// runtime de React Server Components, así que se anula el paquete.
vi.mock("server-only", () => ({}));

import {
  cancelReservation,
  createReservation,
  getAvailability,
  rescheduleReservation,
  type CreateReservationInput,
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
  const supabase = {
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { data: response.data ?? null, error: response.error ?? null };
    }),
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createReservation", () => {
  it("reserva con éxito: genera código FP-8 y devuelve el token en claro", async () => {
    const { supabase, calls } = fakeSupabase([
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

    const result = await createReservation(baseInput(), { supabase });

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
    const { supabase, calls } = fakeSupabase([
      { data: { ok: false, error: "capacity_unavailable", capacity_remaining: 1 } },
    ]);

    const result = await createReservation(baseInput(), { supabase });

    expect(result).toEqual({ ok: false, error: "capacity_unavailable" });
    expect(calls).toHaveLength(1);
  });

  it("reintenta con otro código cuando el RPC devuelve code_taken", async () => {
    const { supabase, calls } = fakeSupabase([
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

    const result = await createReservation(baseInput(), { supabase });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // Ambos intentos usan el MISMO hash de token: solo cambia el código.
    expect(calls[0].params.p_manage_token_hash).toBe(calls[1].params.p_manage_token_hash);
  });

  it("se rinde tras 5 colisiones de código", async () => {
    const { supabase, calls } = fakeSupabase([{ data: { ok: false, error: "code_taken" } }]);

    const result = await createReservation(baseInput(), { supabase });

    expect(result).toEqual({ ok: false, error: "code_taken" });
    expect(calls).toHaveLength(5);
  });

  it("devuelve service_unavailable ante un fallo de transporte, sin filtrar detalles", async () => {
    const { supabase } = fakeSupabase([{ data: null, error: { message: "boom" } }]);

    const result = await createReservation(baseInput(), { supabase });

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
    const { supabase, calls } = fakeSupabase([{ data: rows }]);

    const result = await getAvailability("2026-08-01", "2026-08-31", 2, { supabase });

    expect(result).toEqual({ ok: true, days: rows });
    expect(calls[0].fn).toBe("get_production_availability");
    expect(calls[0].params).toEqual({
      p_start_date: "2026-08-01",
      p_end_date: "2026-08-31",
      p_capacity_points: 2,
    });
  });

  it("devuelve service_unavailable si el RPC falla", async () => {
    const { supabase } = fakeSupabase([{ data: null, error: { message: "boom" } }]);
    const result = await getAvailability("2026-08-01", "2026-08-31", 1, { supabase });
    expect(result).toEqual({ ok: false, error: "service_unavailable" });
  });
});

describe("rescheduleReservation", () => {
  it("envía el hash del token (nunca el token) y mapea la respuesta", async () => {
    const { supabase, calls } = fakeSupabase([
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
      supabase,
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
    const { supabase } = fakeSupabase([
      { data: { ok: false, error: "change_window_closed" } },
    ]);
    const result = await rescheduleReservation("FP-8-TEST", "token", "2026-08-12", { supabase });
    expect(result).toEqual({ ok: false, error: "change_window_closed" });
  });
});

describe("cancelReservation", () => {
  it("cancela y mapea la respuesta", async () => {
    const { supabase, calls } = fakeSupabase([
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

    const result = await cancelReservation("FP-8-TEST", "token-claro", { supabase });

    expect(calls[0].fn).toBe("cancel_cake_reservation");
    expect(calls[0].params.p_manage_token_hash).toBe(hashManageToken("token-claro"));
    expect(result).toMatchObject({ ok: true, status: "cancelled", celebrationDate: "2026-08-10" });
  });

  it("devuelve el mismo error para código o token inválidos (anti-enumeración)", async () => {
    const { supabase } = fakeSupabase([
      { data: { ok: false, error: "reservation_not_found" } },
    ]);
    const result = await cancelReservation("FP-8-XXXX", "token-malo", { supabase });
    expect(result).toEqual({ ok: false, error: "reservation_not_found" });
  });
});

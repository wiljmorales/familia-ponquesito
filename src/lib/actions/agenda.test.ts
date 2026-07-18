import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import {
  fetchAgendaAvailability,
  submitAgendaReservation,
  type AgendaActionDeps,
} from "./agenda";
import type { CreateReservationInput } from "@/reservations/service";

const TODAY = "2026-07-18";

const VALID_ORDER = {
  guestCount: "20",
  tiers: "one",
  isCustomDesign: "yes",
  hasReferenceImage: "no",
  designDescription: "Torta de chocolate con decoración de flores",
  flavor: "chocolate",
  theme: "Flores",
};

const VALID_CONTACT = {
  customerName: "Ana Pérez",
  email: "ana@example.com",
  phone: "0414 1234567",
  fulfillmentType: "pickup",
  deliveryDetails: "",
  companyWebsite: "",
};

const VALID_RESERVATION = {
  ...VALID_ORDER,
  ...VALID_CONTACT,
  celebrationDate: "2026-08-15",
};

function availability(date: string, remaining = 4) {
  return {
    business_date: date,
    capacity_total: 4,
    capacity_used: 4 - remaining,
    capacity_remaining: remaining,
    is_blocked: false,
    can_accept: remaining > 0,
  };
}

function deps(
  overrides: Partial<AgendaActionDeps> = {},
): AgendaActionDeps {
  return {
    businessTodayISOFn: () => TODAY,
    isReservationAllowedFn: vi.fn(async () => true),
    getAvailabilityFn: vi.fn(async () => ({
      ok: true as const,
      days: [availability("2026-08-15")],
    })),
    createReservationFn: vi.fn(async () => ({
      ok: true as const,
      reservationId: "reservation-1",
      code: "FP-8-ABCD",
      status: "pending_deposit" as const,
      capacityTotal: 4,
      capacityUsed: 2,
      capacityRemaining: 2,
      manageToken: "token-privado",
    })),
    scheduleAfterFn: vi.fn(),
    processReservationLeadFn: vi.fn<AgendaActionDeps["processReservationLeadFn"]>(
      async () => {},
    ),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAgendaAvailability", () => {
  it("recalcula la clasificación en servidor y consulta con los puntos resultantes", async () => {
    const testDeps = deps();
    const result = await fetchAgendaAvailability(VALID_ORDER, "2026-08", testDeps);

    expect(result.ok).toBe(true);
    expect(testDeps.getAvailabilityFn).toHaveBeenCalledWith(
      "2026-08-01",
      "2026-08-31",
      2,
    );
  });

  it("ignora puntos y estado que un cliente intente imponer", async () => {
    const testDeps = deps();
    await fetchAgendaAvailability(
      { ...VALID_ORDER, capacityPoints: 1, status: "confirmed" },
      "2026-08",
      testDeps,
    );

    expect(testDeps.getAvailabilityFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      2,
    );
  });
});

describe("submitAgendaReservation", () => {
  it("crea una reserva exitosa sin devolver el token al navegador", async () => {
    const scheduleAfterFn = vi.fn();
    const processReservationLeadFn = vi.fn<
      AgendaActionDeps["processReservationLeadFn"]
    >(async () => {});
    const testDeps = deps({ scheduleAfterFn, processReservationLeadFn });
    const result = await submitAgendaReservation(
      { ...VALID_RESERVATION, capacityRemaining: 999 },
      testDeps,
    );

    expect(result).toEqual({
      ok: true,
      code: "FP-8-ABCD",
      celebrationDate: "2026-08-15",
      status: "pending_deposit",
    });
    expect(JSON.stringify(result)).not.toContain("token-privado");
    expect(scheduleAfterFn).toHaveBeenCalledTimes(1);
    expect(processReservationLeadFn).not.toHaveBeenCalled();

    const task = scheduleAfterFn.mock.calls[0][0];
    await task();
    expect(processReservationLeadFn).toHaveBeenCalledTimes(1);
    const [leadInput, emailContext] = processReservationLeadFn.mock.calls[0];
    expect(emailContext.capacity).toEqual({
      total: 4,
      used: 2,
      remaining: 2,
      provisional: false,
    });
    expect(emailContext.manageUrl).toContain(
      "/agenda/reservas/FP-8-ABCD?token=token-privado",
    );
    const persistible = JSON.stringify(leadInput);
    expect(persistible).not.toContain("token-privado");
    expect(persistible).not.toContain(emailContext.manageUrl);
  });

  it("recalcula puntos y estado aunque el cliente intente imponerlos", async () => {
    const createReservationFn = vi.fn(async (input: CreateReservationInput) => ({
      ok: true as const,
      reservationId: "reservation-1",
      code: "FP-8-ABCD",
      status: input.status,
      capacityTotal: 4,
      capacityUsed: 2,
      capacityRemaining: 2,
      manageToken: "token",
    }));
    const testDeps = deps({ createReservationFn });

    await submitAgendaReservation(
      {
        ...VALID_RESERVATION,
        capacityPoints: 1,
        status: "confirmed",
        code: "ATACANTE",
        manageTokenHash: "hash-atacante",
      },
      testDeps,
    );

    expect(createReservationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        capacityPoints: 2,
        status: "pending_deposit",
      }),
    );
    const persisted = JSON.stringify(createReservationFn.mock.calls[0][0]);
    expect(persisted).not.toContain("ATACANTE");
    expect(persisted).not.toContain("hash-atacante");
  });

  it("el honeypot responde sin consultar el rate limit ni crear una reserva", async () => {
    const testDeps = deps();
    const result = await submitAgendaReservation(
      { ...VALID_RESERVATION, companyWebsite: "https://spam.example" },
      testDeps,
    );

    expect(result.ok).toBe(true);
    expect(testDeps.isReservationAllowedFn).not.toHaveBeenCalled();
    expect(testDeps.createReservationFn).not.toHaveBeenCalled();
    expect(testDeps.scheduleAfterFn).not.toHaveBeenCalled();
  });

  it("devuelve un mensaje amable cuando el rate limit rechaza la solicitud", async () => {
    const testDeps = deps({
      isReservationAllowedFn: vi.fn(async () => false),
    });
    const result = await submitAgendaReservation(VALID_RESERVATION, testDeps);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain("Espera unos minutos");
    expect(testDeps.createReservationFn).not.toHaveBeenCalled();
  });

  it("human_review usa tres puntos, crea el estado correcto y no acepta autoridad del cliente", async () => {
    const createReservationFn = vi.fn(async (input: CreateReservationInput) => ({
      ok: true as const,
      reservationId: "reservation-human",
      code: "FP-8-HUMN",
      status: input.status,
      capacityTotal: 4,
      capacityUsed: 1,
      capacityRemaining: 4,
      manageToken: "token",
    }));
    const testDeps = deps({ createReservationFn });

    const result = await submitAgendaReservation(
      {
        ...VALID_RESERVATION,
        designDescription: "Torta antigravedad con luces y movimiento",
        status: "confirmed",
        capacityPoints: 1,
      },
      testDeps,
    );

    expect(result).toMatchObject({ ok: true, status: "human_review" });
    expect(createReservationFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "human_review", capacityPoints: 3 }),
    );
    const task = vi.mocked(testDeps.scheduleAfterFn).mock.calls[0][0];
    await task();
    expect(testDeps.processReservationLeadFn).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: expect.objectContaining({ status: "human_review" }),
      }),
      expect.objectContaining({
        capacity: expect.objectContaining({ provisional: true }),
      }),
    );
  });

  it("capacity_unavailable consulta alternativas actuales y las devuelve ordenadas", async () => {
    const getAvailabilityFn = vi.fn(async () => ({
      ok: true as const,
      days: [
        availability("2026-08-14", 2),
        availability("2026-08-16", 2),
        availability("2026-08-20", 2),
      ],
    }));
    const testDeps = deps({
      createReservationFn: vi.fn(async () => ({
        ok: false as const,
        error: "capacity_unavailable" as const,
      })),
      getAvailabilityFn,
    });

    const result = await submitAgendaReservation(VALID_RESERVATION, testDeps);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).toContain("se acaba de llenar");
      expect(result.alternatives?.map((item) => item.date)).toEqual([
        "2026-08-16",
        "2026-08-14",
        "2026-08-20",
      ]);
    }
    expect(getAvailabilityFn).toHaveBeenCalledWith(
      "2026-07-21",
      "2026-09-16",
      2,
    );
    expect(testDeps.scheduleAfterFn).not.toHaveBeenCalled();
  });

  it("un fallo de servicio devuelve un error genérico sin detalles ni datos del cliente", async () => {
    const testDeps = deps({
      createReservationFn: vi.fn(async () => ({
        ok: false as const,
        error: "service_unavailable" as const,
      })),
    });
    const result = await submitAgendaReservation(VALID_RESERVATION, testDeps);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({ ok: false });
    expect(serialized).not.toContain("ana@example.com");
    expect(serialized).not.toContain("Ana Pérez");
    expect(serialized).not.toContain("service_unavailable");
    expect(testDeps.scheduleAfterFn).not.toHaveBeenCalled();
  });
});

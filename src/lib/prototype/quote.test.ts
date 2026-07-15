import { describe, expect, it } from "vitest";
import { DEPOSIT_PERCENT } from "@/lib/constants/business";
import { createPrototypeOrders } from "@/data/prototype-orders";
import type { QuoteInput } from "@/types/prototype";
import {
  buildCustomerMessage,
  computeQuoteTotals,
  defaultConfirmDeadline,
  defaultQuoteFormValues,
  formatMoney,
  isPreviewableQuote,
  isQuoteValid,
  latestConfirmDeadline,
  quoteInputFromForm,
  validateQuote,
  type QuoteFormValues,
} from "./quote";

const BASE_DATE = "2026-03-10";

// Pedido demo principal: celebración el 2026-03-19 (base + 9).
const ORDER = createPrototypeOrders(BASE_DATE)[0];

const CONTEXT = { baseDate: BASE_DATE, celebrationDate: ORDER.celebrationDate };

function validInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    basePrice: 80,
    decorationPrice: 25,
    deliveryEnabled: true,
    deliveryPrice: 5,
    discount: 0,
    confirmDeadline: "2026-03-12",
    personalNote: "",
    ...overrides,
  };
}

describe("computeQuoteTotals", () => {
  it("suma base, decoración y delivery cuando está activo", () => {
    const { subtotal, total } = computeQuoteTotals(validInput());
    expect(subtotal).toBe(110);
    expect(total).toBe(110);
  });

  it("excluye el delivery al desactivarlo aunque tenga monto", () => {
    const withDelivery = computeQuoteTotals(validInput({ deliveryPrice: 12 }));
    const withoutDelivery = computeQuoteTotals(
      validInput({ deliveryPrice: 12, deliveryEnabled: false }),
    );
    expect(withDelivery.total).toBe(117);
    expect(withoutDelivery.total).toBe(105);
  });

  it("resta el descuento del total pero no del subtotal", () => {
    const { subtotal, total } = computeQuoteTotals(validInput({ discount: 10 }));
    expect(subtotal).toBe(110);
    expect(total).toBe(100);
  });

  it("calcula el anticipo como el porcentaje real de reserva del negocio", () => {
    const { total, deposit } = computeQuoteTotals(validInput());
    expect(DEPOSIT_PERCENT).toBe(50);
    expect(deposit).toBe((total * DEPOSIT_PERCENT) / 100);
    expect(deposit).toBe(55);
  });

  it("redondea el total a dos decimales", () => {
    const { total } = computeQuoteTotals(
      validInput({ basePrice: 80.554, decorationPrice: 0, deliveryEnabled: false }),
    );
    expect(total).toBe(80.55);
  });

  it("calcula anticipos con centavos exactos", () => {
    const { total, deposit } = computeQuoteTotals(
      validInput({ basePrice: 85.5, decorationPrice: 25, deliveryEnabled: false }),
    );
    expect(total).toBe(110.5);
    expect(deposit).toBe(55.25);
  });
});

describe("validateQuote", () => {
  it("acepta una cotización completa y coherente", () => {
    expect(validateQuote(validInput(), CONTEXT)).toEqual({});
    expect(isQuoteValid(validInput(), CONTEXT)).toBe(true);
  });

  it("exige un precio base mayor que cero", () => {
    expect(validateQuote(validInput({ basePrice: 0 }), CONTEXT)).toHaveProperty("basePrice");
    expect(validateQuote(validInput({ basePrice: Number.NaN }), CONTEXT)).toHaveProperty(
      "basePrice",
    );
  });

  it("rechaza montos negativos", () => {
    expect(validateQuote(validInput({ decorationPrice: -1 }), CONTEXT)).toHaveProperty(
      "decorationPrice",
    );
    expect(validateQuote(validInput({ deliveryPrice: -1 }), CONTEXT)).toHaveProperty(
      "deliveryPrice",
    );
    expect(validateQuote(validInput({ discount: -1 }), CONTEXT)).toHaveProperty("discount");
  });

  it("ignora un delivery negativo si el delivery está desactivado", () => {
    const input = validInput({ deliveryEnabled: false, deliveryPrice: -1 });
    expect(validateQuote(input, CONTEXT)).toEqual({});
  });

  it("rechaza un descuento igual o mayor al subtotal", () => {
    expect(validateQuote(validInput({ discount: 110 }), CONTEXT)).toHaveProperty("discount");
    expect(validateQuote(validInput({ discount: 200 }), CONTEXT)).toHaveProperty("discount");
  });

  it("exige la fecha límite y que no quede en el pasado", () => {
    expect(validateQuote(validInput({ confirmDeadline: "" }), CONTEXT)).toHaveProperty(
      "confirmDeadline",
    );
    expect(
      validateQuote(validInput({ confirmDeadline: "2026-03-09" }), CONTEXT),
    ).toHaveProperty("confirmDeadline");
  });

  it("rechaza una fecha límite que viole la anticipación mínima de 3 días", () => {
    // Celebración el 2026-03-19: el máximo admisible es el 2026-03-16.
    expect(latestConfirmDeadline(ORDER.celebrationDate)).toBe("2026-03-16");
    expect(
      validateQuote(validInput({ confirmDeadline: "2026-03-17" }), CONTEXT),
    ).toHaveProperty("confirmDeadline");
    expect(validateQuote(validInput({ confirmDeadline: "2026-03-16" }), CONTEXT)).toEqual({});
  });
});

describe("defaultConfirmDeadline", () => {
  it("propone pasado mañana cuando hay margen", () => {
    expect(defaultConfirmDeadline(BASE_DATE, ORDER.celebrationDate)).toBe("2026-03-12");
  });

  it("se recorta al máximo admisible cuando la celebración está cerca", () => {
    // Celebración a 4 días: el máximo admisible es base + 1.
    expect(defaultConfirmDeadline(BASE_DATE, "2026-03-14")).toBe("2026-03-11");
  });

  it("nunca propone una fecha anterior a la base", () => {
    // Celebración exactamente en el mínimo (base + 3): confirmar hoy.
    expect(defaultConfirmDeadline(BASE_DATE, "2026-03-13")).toBe(BASE_DATE);
  });
});

function formValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    basePrice: "80",
    decorationPrice: "25",
    deliveryEnabled: true,
    deliveryPrice: "5",
    discount: "",
    confirmDeadline: "2026-03-12",
    personalNote: "",
    ...overrides,
  };
}

describe("quoteInputFromForm", () => {
  it("convierte strings a números y los opcionales vacíos valen 0", () => {
    const input = quoteInputFromForm(formValues());
    expect(input.basePrice).toBe(80);
    expect(input.decorationPrice).toBe(25);
    expect(input.deliveryPrice).toBe(5);
    expect(input.discount).toBe(0);
  });

  it("el precio base vacío queda NaN para que la validación lo exija", () => {
    const input = quoteInputFromForm(formValues({ basePrice: "  " }));
    expect(Number.isNaN(input.basePrice)).toBe(true);
    expect(validateQuote(input, CONTEXT)).toHaveProperty("basePrice");
  });

  it("acepta coma decimal y rechaza texto no numérico vía validación", () => {
    expect(quoteInputFromForm(formValues({ basePrice: "80,50" })).basePrice).toBe(80.5);
    const garbage = quoteInputFromForm(formValues({ basePrice: "abc" }));
    expect(Number.isNaN(garbage.basePrice)).toBe(true);
  });
});

describe("defaultQuoteFormValues", () => {
  it("propone montos vacíos, delivery según el pedido y la fecha límite de la regla", () => {
    const values = defaultQuoteFormValues(ORDER, BASE_DATE);
    expect(values.basePrice).toBe("");
    expect(values.deliveryEnabled).toBe(true); // PED-001 pidió delivery
    expect(values.confirmDeadline).toBe(defaultConfirmDeadline(BASE_DATE, ORDER.celebrationDate));
  });

  it("desactiva el delivery cuando el pedido es retiro", () => {
    const retiro = createPrototypeOrders(BASE_DATE)[1]; // PED-002, retiro
    expect(defaultQuoteFormValues(retiro, BASE_DATE).deliveryEnabled).toBe(false);
  });
});

describe("isPreviewableQuote", () => {
  it("permite la vista previa con montos numéricos y fecha bien formada", () => {
    expect(isPreviewableQuote(quoteInputFromForm(formValues()))).toBe(true);
  });

  it("bloquea la vista previa con base vacía o fecha malformada", () => {
    expect(isPreviewableQuote(quoteInputFromForm(formValues({ basePrice: "" })))).toBe(false);
    expect(
      isPreviewableQuote(quoteInputFromForm(formValues({ confirmDeadline: "" }))),
    ).toBe(false);
  });

  it("no exige validez completa: una fecha vencida sigue siendo previsualizable", () => {
    const input = quoteInputFromForm(formValues({ confirmDeadline: "2020-01-01" }));
    expect(isPreviewableQuote(input)).toBe(true);
    expect(isQuoteValid(input, CONTEXT)).toBe(false);
  });

  it("ignora un delivery no numérico si está desactivado", () => {
    const input = quoteInputFromForm(
      formValues({ deliveryEnabled: false, deliveryPrice: "abc" }),
    );
    expect(isPreviewableQuote(input)).toBe(true);
  });
});

describe("formatMoney", () => {
  it("muestra enteros sin decimales y decimales con coma", () => {
    expect(formatMoney(120)).toBe("US$ 120");
    expect(formatMoney(120.5)).toBe("US$ 120,50");
    expect(formatMoney(99.9)).toBe("US$ 99,90");
  });
});

describe("buildCustomerMessage", () => {
  it("incluye cliente, total, anticipo, fecha límite y la nota del 50 %", () => {
    const message = buildCustomerMessage(ORDER, validInput());
    expect(message).toContain(ORDER.customerName);
    expect(message).toContain("Total: US$ 110");
    expect(message).toContain("Anticipo para reservar (50 %): US$ 55");
    expect(message).toContain("12 de marzo de 2026");
    expect(message).toContain("La reserva se confirma con el 50 % del monto");
    expect(message).toContain("Pago Móvil");
    expect(message).toContain("Mercantil Panamá");
  });

  it("menciona el delivery solo cuando está activo", () => {
    expect(buildCustomerMessage(ORDER, validInput())).toContain("delivery");
    expect(
      buildCustomerMessage(ORDER, validInput({ deliveryEnabled: false })),
    ).not.toContain("delivery");
  });

  it("añade la nota personal cuando existe", () => {
    const message = buildCustomerMessage(
      ORDER,
      validInput({ personalNote: "¡Gracias por preferirnos!" }),
    );
    expect(message).toContain("¡Gracias por preferirnos!");
  });
});

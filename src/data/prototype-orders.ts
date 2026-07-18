/**
 * Datos de demostración del prototipo "Centro de pedidos" (Reto 5).
 *
 * Nada aquí es un cliente real: nombres inventados, teléfono de
 * demostración y fechas relativas a la fecha base que recibe
 * `createPrototypeOrders`. Se genera con una función (y no como constante
 * de módulo) a propósito: llamar `new Date()` al importar produciría
 * pruebas inestables, diferencias servidor/cliente y pedidos vencidos con
 * el paso del tiempo (ver docs/challenge-5.md).
 *
 * Lo que sí es real: sabores, tipos de celebración y políticas del negocio
 * (anticipación mínima, reserva del 50 %, delivery por Vamos con costo
 * adicional, zona este de Barquisimeto), tomados de las constantes del
 * Reto 2 y la base de conocimiento del Reto 1.
 */

import type { PrototypeOrder } from "@/types/prototype";
import { addDaysISO } from "@/lib/business-dates";

/** Contacto claramente ficticio, igual en todos los pedidos demo. */
export const DEMO_PHONE = "0412-0000000";

const DEMO_ZONE = "Este de Barquisimeto";

/**
 * Genera las cinco solicitudes de la demo, una por cada estado del pedido.
 * `baseDate` es "YYYY-MM-DD" (día calendario del negocio); las
 * celebraciones quedan entre 4 y 12 días adelante, siempre respetando la
 * anticipación mínima de 3 días.
 */
export function createPrototypeOrders(baseDate: string): PrototypeOrder[] {
  return [
    {
      // El pedido preparado para recorrer el flujo completo de la demo:
      // llega como solicitud nueva el mismo día de la presentación.
      id: "PED-001",
      customerName: "Mariana Suárez",
      whatsapp: DEMO_PHONE,
      celebrationType: "Celebración infantil",
      celebrationDate: addDaysISO(baseDate, 9),
      guestCount: 25,
      flavor: "Vainilla",
      cakeDescription:
        "Torta de dos pisos con unicornio, tonos pastel y nombre de la cumpleañera",
      deliveryMethod: "delivery",
      zone: DEMO_ZONE,
      visualReference: "Foto de Pinterest adjunta (referencia simulada)",
      receivedDate: baseDate,
      status: "new",
      notes: "La cliente pregunta si es posible confirmar esta misma semana.",
      isDemoFlowOrder: true,
    },
    {
      id: "PED-002",
      customerName: "Luis Perdomo",
      whatsapp: DEMO_PHONE,
      celebrationType: "Aniversario",
      celebrationDate: addDaysISO(baseDate, 4),
      guestCount: 12,
      flavor: "Chocolate",
      cakeDescription: "Torta de un piso con topper 'Felices 20 años' y flores",
      deliveryMethod: "retiro",
      zone: null,
      visualReference: "Describe el diseño por texto (sin foto)",
      receivedDate: addDaysISO(baseDate, -1),
      status: "reviewing",
      notes: "Fecha cercana: conviene responder hoy para no perder el pedido.",
      isDemoFlowOrder: false,
    },
    {
      id: "PED-003",
      customerName: "Carmen Álvarez",
      whatsapp: DEMO_PHONE,
      celebrationType: "Graduación",
      celebrationDate: addDaysISO(baseDate, 12),
      guestCount: 40,
      flavor: "Red velvet",
      cakeDescription: "Torta con birrete, diploma y colores de la universidad",
      deliveryMethod: "delivery",
      zone: DEMO_ZONE,
      visualReference: "Diseño del juego 'Crea tu torta' (simulado)",
      receivedDate: addDaysISO(baseDate, -2),
      status: "to_quote",
      notes: "Ya se revisó la solicitud; falta preparar la cotización.",
      isDemoFlowOrder: false,
    },
    {
      id: "PED-004",
      customerName: "José Camacaro",
      whatsapp: DEMO_PHONE,
      celebrationType: "Cumpleaños",
      celebrationDate: addDaysISO(baseDate, 8),
      guestCount: 20,
      flavor: "Tres leches",
      cakeDescription: "Torta temática de fútbol con camiseta número 10",
      deliveryMethod: "retiro",
      zone: null,
      visualReference: "Foto de una torta anterior del negocio (simulada)",
      receivedDate: addDaysISO(baseDate, -3),
      status: "waiting_deposit",
      notes: "Cotización enviada; espera el anticipo del 50 % para reservar.",
      isDemoFlowOrder: false,
    },
    {
      id: "PED-005",
      customerName: "Ana Torrealba",
      whatsapp: DEMO_PHONE,
      celebrationType: "Reunión familiar",
      celebrationDate: addDaysISO(baseDate, 5),
      guestCount: 30,
      flavor: "Chocolate",
      cakeDescription: "Torta sencilla con frutas y mensaje 'Bienvenidos a casa'",
      deliveryMethod: "delivery",
      zone: DEMO_ZONE,
      visualReference: "Sin referencia: confía en el criterio de la repostera",
      receivedDate: addDaysISO(baseDate, -4),
      status: "confirmed",
      notes: "Anticipo recibido; entra en la producción de la semana.",
      isDemoFlowOrder: false,
    },
  ];
}

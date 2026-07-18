/**
 * Configuración central de capacidad de producción de Agenda Ponquesito
 * (Reto 8). Los "puntos" son una regla interna del negocio: miden carga de
 * producción, no precio, y jamás se muestran al cliente con ese nombre.
 *
 * IMPORTANTE: la autoridad en tiempo de ejecución es PostgreSQL — los
 * helpers agenda_default_capacity(), agenda_min_lead_days() y
 * agenda_booking_window_days() de supabase/schema.sql deben mantenerse
 * alineados con estas constantes. sql-alignment.test.ts falla si divergen.
 */

/** Capacidad de producción por día (en puntos) cuando no hay override. */
export const DEFAULT_DAILY_CAPACITY = 4;

/** Cuántos días hacia adelante se puede reservar (ventana de reserva). */
export const BOOKING_WINDOW_DAYS = 60;

/** Torta sencilla: un piso, sin diseño personalizado complejo. */
export const SIMPLE_CAKE_POINTS = 1;

/** Torta personalizada: decoración temática, referencia visual o pedido grande. */
export const CUSTOM_CAKE_POINTS = 2;

/** Diseño especial: varios pisos o complejidad estructural declarada. */
export const COMPLEX_CAKE_POINTS = 3;

export type CapacityPoints =
  | typeof SIMPLE_CAKE_POINTS
  | typeof CUSTOM_CAKE_POINTS
  | typeof COMPLEX_CAKE_POINTS;

/**
 * Umbral interno de "mayor cantidad de porciones" (criterio de 2 puntos
 * del brief): desde esta cantidad de invitados, una torta aunque sea
 * sencilla exige más horas de horno y por eso pesa como personalizada.
 * Heurística interna de carga de producción, ajustable aquí.
 */
export const LARGE_ORDER_GUEST_THRESHOLD = 40;

/**
 * "Pocos cupos": un día se marca así cuando, después de aceptar el pedido
 * actual, quedaría este número de puntos libres o menos.
 */
export const LOW_CAPACITY_REMAINING_AFTER_BOOKING = 1;

/**
 * Asignación de mesas y retrasos del servicio. Umbrales en minutos.
 */

/** Si nadie reclama una mesa abierta por el cliente en este tiempo, se asigna sola. */
export const CLAIM_TIMEOUT_MIN = 5;

export const DELAY_THRESHOLDS = {
  /** Plato cocinado esperando a que el camarero lo lleve. */
  readyNotServed: 5,
  /** Bebida o postre pedido y aún sin llevar. */
  drinkNotServed: 5,
  /** Pedido hecho hace tiempo y todavía con platos sin servir. */
  orderOpen: 25,
  /** Llamada o petición de cuenta sin atender. */
  callUnanswered: 3,
  /** Pedido del móvil esperando aprobación. */
  approvalPending: 3,
  /** Comanda que cocina aún no ha empezado. */
  kitchenNotStarted: 5,
  /** Plato que sigue en preparación este tiempo después de su hora prevista. */
  kitchenSlow: 5,
} as const;

export const ASSIGN_MODES = ["opened", "claimed", "auto", "manager", "zone"] as const;
/**
 * opened: abrió la mesa el propio camarero. claimed: la cogió del aviso. auto: asignada sola.
 * manager: la asignó el encargado. zone: asignada al camarero de la zona de la mesa.
 */
export type AssignMode = (typeof ASSIGN_MODES)[number];

export const DELAY_KINDS = [
  "ready_not_served",
  "drink_not_served",
  "order_open",
  "call_unanswered",
  "approval_pending",
  "kitchen_not_started",
  "kitchen_slow",
] as const;
export type DelayKind = (typeof DELAY_KINDS)[number];

/** A quién le toca resolver cada retraso. */
export const DELAY_AUDIENCE: Record<DelayKind, "floor" | "kitchen"> = {
  ready_not_served: "floor",
  drink_not_served: "floor",
  order_open: "floor",
  call_unanswered: "floor",
  approval_pending: "floor",
  kitchen_not_started: "kitchen",
  kitchen_slow: "kitchen",
};

export const DELAY_LABEL: Record<DelayKind, string> = {
  ready_not_served: "Plato listo sin llevar",
  drink_not_served: "Bebida o postre sin llevar",
  order_open: "Pedido sin completar",
  call_unanswered: "Llamada sin atender",
  approval_pending: "Pedido sin aprobar",
  kitchen_not_started: "Comanda sin empezar",
  kitchen_slow: "Plato tardando",
};

/** Minutos de cocina por defecto si el plato no tiene tiempo propio. */
export const DEFAULT_PREP_MINUTES = 12;

// ---------- Reservas ----------

export const RESERVATION_STATUSES = ["confirmed", "seated", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ReservationSettings {
  enabled: boolean;
  /** Cada cuántos minutos hay un turno de reserva (13:00, 13:30…). */
  slotMinutes: number;
  /** Cuánto ocupa una reserva la mesa. */
  durationMinutes: number;
  /** Comensales con reserva que caben a la vez. */
  maxCovers: number;
  /** Máximo de personas por reserva (grupos mayores: que llamen). */
  maxPartySize: number;
  /** Antelación mínima en minutos. */
  minNoticeMinutes: number;
  /** Horario de reservas por día, p. ej. "13:00-16:00, 20:00-23:00". Vacío: cerrado. */
  hours: Record<Weekday, string>;
}

export const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  enabled: true,
  slotMinutes: 30,
  durationMinutes: 90,
  maxCovers: 40,
  maxPartySize: 10,
  minNoticeMinutes: 60,
  hours: {
    mon: "13:00-16:00, 20:00-23:00",
    tue: "13:00-16:00, 20:00-23:00",
    wed: "13:00-16:00, 20:00-23:00",
    thu: "13:00-16:00, 20:00-23:00",
    fri: "13:00-16:00, 20:00-23:30",
    sat: "13:00-16:30, 20:00-23:30",
    sun: "13:00-16:30",
  },
};

export function resolveReservationSettings(stored: unknown): ReservationSettings {
  const s = (stored ?? {}) as Partial<ReservationSettings>;
  return { ...DEFAULT_RESERVATION_SETTINGS, ...s, hours: { ...DEFAULT_RESERVATION_SETTINGS.hours, ...(s.hours ?? {}) } };
}

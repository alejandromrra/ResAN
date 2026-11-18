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
  /** Plato que tarda demasiado en estar listo desde que se pidió. */
  kitchenSlow: 15,
} as const;

export const ASSIGN_MODES = ["opened", "claimed", "auto", "manager"] as const;
/** opened: abrió la mesa el propio camarero. claimed: la cogió del aviso. auto: asignada sola. manager: la asignó el encargado. */
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

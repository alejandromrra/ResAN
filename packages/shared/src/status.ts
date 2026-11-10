import { can, type Permission, type Role } from "./rbac";

export const ORDER_MODES = ["direct", "approval", "view_only"] as const;
/** direct: el pedido entra solo. approval: lo valida un camarero. view_only: solo consulta. */
export type OrderMode = (typeof ORDER_MODES)[number];

export const SESSION_OPEN_MODES = ["auto", "staff"] as const;
/** auto: la sesión se abre al primer escaneo. staff: la abre el personal. */
export type SessionOpenMode = (typeof SESSION_OPEN_MODES)[number];

export const FULFILLMENTS = ["kitchen", "serve"] as const;
/** kitchen: se cocina. serve: solo se sirve (bebidas, postres, cafés). */
export type Fulfillment = (typeof FULFILLMENTS)[number];

export const ITEM_STATUSES = [
  "pending_approval",
  "new",
  "preparing",
  "ready",
  "served",
  "cancelled",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

interface Transition {
  from: ItemStatus;
  to: ItemStatus;
  fulfillment: Fulfillment | "any";
  permission: Permission;
}

const TRANSITIONS: readonly Transition[] = [
  // Aprobación de pedidos del QR
  { from: "pending_approval", to: "new", fulfillment: "any", permission: "orders.approve" },
  { from: "pending_approval", to: "cancelled", fulfillment: "any", permission: "orders.approve" },
  // Cocina
  { from: "new", to: "preparing", fulfillment: "kitchen", permission: "kitchen.update" },
  { from: "preparing", to: "ready", fulfillment: "kitchen", permission: "kitchen.update" },
  { from: "preparing", to: "new", fulfillment: "kitchen", permission: "kitchen.update" },
  { from: "ready", to: "preparing", fulfillment: "kitchen", permission: "kitchen.update" },
  // Servicio en sala
  { from: "ready", to: "served", fulfillment: "kitchen", permission: "items.serve" },
  { from: "new", to: "served", fulfillment: "serve", permission: "items.serve" },
  // Deshacer y anular (encargado o propietario)
  { from: "served", to: "ready", fulfillment: "kitchen", permission: "orders.void" },
  { from: "served", to: "new", fulfillment: "serve", permission: "orders.void" },
  { from: "new", to: "cancelled", fulfillment: "any", permission: "orders.void" },
  { from: "preparing", to: "cancelled", fulfillment: "kitchen", permission: "orders.void" },
  { from: "ready", to: "cancelled", fulfillment: "kitchen", permission: "orders.void" },
];

export function canTransition(
  role: Role,
  fulfillment: Fulfillment,
  from: ItemStatus,
  to: ItemStatus,
): boolean {
  return TRANSITIONS.some(
    (t) =>
      t.from === from &&
      t.to === to &&
      (t.fulfillment === "any" || t.fulfillment === fulfillment) &&
      can(role, t.permission),
  );
}

export function allowedNextStatuses(
  role: Role,
  fulfillment: Fulfillment,
  from: ItemStatus,
): ItemStatus[] {
  return ITEM_STATUSES.filter((to) => canTransition(role, fulfillment, from, to));
}

export const TABLE_STATUSES = [
  "free",
  "occupied",
  "waiting_food",
  "paying",
  "ready_to_serve",
  "pending_approval",
  "calling",
  "bill_requested",
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export interface TableActivity {
  hasOpenSession: boolean;
  billRequested: boolean;
  waiterCalling: boolean;
  billPrinted: boolean;
  pendingApproval: number;
  readyToServe: number;
  inProgress: number;
}

/** Prioridad: lo más urgente para el camarero gana. */
export function deriveTableStatus(a: TableActivity): TableStatus {
  if (!a.hasOpenSession) return "free";
  if (a.billRequested) return "bill_requested";
  if (a.waiterCalling) return "calling";
  if (a.pendingApproval > 0) return "pending_approval";
  if (a.readyToServe > 0) return "ready_to_serve";
  if (a.billPrinted) return "paying";
  if (a.inProgress > 0) return "waiting_food";
  return "occupied";
}

export const PAYMENT_METHODS = ["cash", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CALL_TYPES = ["waiter", "bill"] as const;
export type CallType = (typeof CALL_TYPES)[number];

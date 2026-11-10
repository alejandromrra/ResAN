export const ROLES = ["owner", "manager", "waiter", "kitchen"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const PERMISSIONS = [
  "menu.edit",
  "item.availability",
  "tables.view",
  "tables.manage",
  "session.open",
  "session.close_force",
  "orders.create_for_guest",
  "orders.approve",
  "orders.void",
  "kitchen.view",
  "kitchen.update",
  "items.serve",
  "calls.handle",
  "bill.manage",
  "stats.view",
  "users.manage",
  "venue.settings",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Matriz de permisos inicial (informe, sección 4).
 * "Con aprobación" para anulaciones del camarero queda para la fase 2.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== "venue.settings"),
  waiter: [
    "item.availability",
    "tables.view",
    "session.open",
    "orders.create_for_guest",
    "orders.approve",
    "kitchen.view",
    "items.serve",
    "calls.handle",
    "bill.manage",
  ],
  kitchen: ["item.availability", "kitchen.view", "kitchen.update"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

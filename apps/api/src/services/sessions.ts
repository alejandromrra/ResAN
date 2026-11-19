import { and, eq, inArray, ne } from "drizzle-orm";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { orderItems, orders, serviceCalls, tableSessions, tables } from "../db/schema";
import { isUniqueViolation } from "../lib/errors";
import { assignSession, assignToZone } from "./assignment";

export type SessionRow = typeof tableSessions.$inferSelect;

export async function findOpenSession(db: Db, tableId: string): Promise<SessionRow | undefined> {
  const [s] = await db
    .select()
    .from(tableSessions)
    .where(and(eq(tableSessions.tableId, tableId), ne(tableSessions.status, "closed")))
    .limit(1);
  return s;
}

export async function openSession(
  ctx: Ctx,
  venueId: string,
  tableId: string,
  openedBy?: string,
): Promise<{ session: SessionRow; created: boolean }> {
  const existing = await findOpenSession(ctx.db, tableId);
  if (existing) {
    // El personal que «abre» una mesa ya abierta por el cliente y sin camarero se la queda
    if (openedBy && !existing.assignedTo) {
      await assignSession(ctx, { venueId, sessionId: existing.id, userId: openedBy, mode: "claimed", by: openedBy, onlyIfUnassigned: true });
    }
    return { session: existing, created: false };
  }
  try {
    const [session] = await ctx.db
      .insert(tableSessions)
      .values({ venueId, tableId, openedBy: openedBy ?? null })
      .returning();
    // Si la abre el camarero, la lleva él. Si la abre el cliente, se ofrece a los camareros.
    if (openedBy) await assignSession(ctx, { venueId, sessionId: session!.id, userId: openedBy, mode: "opened", by: openedBy });
    else await assignToZone(ctx, venueId, session!.id);
    ctx.bus.publish(venueId, { type: "session.updated", sessionId: session!.id, tableId });
    return { session: session!, created: true };
  } catch (e) {
    // Dos escaneos a la vez: gana el primero y el segundo reutiliza su sesión.
    if (isUniqueViolation(e)) {
      const again = await findOpenSession(ctx.db, tableId);
      if (again) return { session: again, created: false };
    }
    throw e;
  }
}

/** Cierra sin cobrar todas las mesas abiertas del local. Devuelve sus etiquetas. */
export async function closeAllOpenSessions(ctx: Ctx, venueId: string, reason: string): Promise<string[]> {
  const open = await ctx.db
    .select({ id: tableSessions.id, venueId: tableSessions.venueId, tableId: tableSessions.tableId, label: tables.label })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(and(eq(tableSessions.venueId, venueId), ne(tableSessions.status, "closed")));
  for (const s of open) await closeSession(ctx, s, reason, { cancelUnfinished: true });
  // Restos de mesas ya cerradas (p. ej. cobradas antes de servirlo todo): se anulan
  const closedIds = ctx.db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(and(eq(tableSessions.venueId, venueId), eq(tableSessions.status, "closed")));
  await ctx.db
    .update(orderItems)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(orderItems.venueId, venueId), inArray(orderItems.status, ["new", "preparing", "ready"]), inArray(orderItems.sessionId, closedIds)));
  return open.map((s) => s.label);
}

export async function closeSession(
  ctx: Ctx,
  session: Pick<SessionRow, "id" | "venueId" | "tableId">,
  reason: string,
  /** Al cerrar sin cobrar: anula lo que aún no se ha servido para que no siga en cocina ni en sala. */
  opts: { cancelUnfinished?: boolean } = {},
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    if (opts.cancelUnfinished) {
      await tx
        .update(orderItems)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(orderItems.sessionId, session.id), inArray(orderItems.status, ["new", "preparing", "ready"])));
    }
    await tx
      .update(tableSessions)
      .set({ status: "closed", closedAt: new Date(), closedReason: reason })
      .where(and(eq(tableSessions.id, session.id), ne(tableSessions.status, "closed")));
    await tx
      .update(serviceCalls)
      .set({ status: "done" })
      .where(and(eq(serviceCalls.sessionId, session.id), ne(serviceCalls.status, "done")));
    // Pedidos del QR sin validar ya no tienen sentido
    const pending = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.sessionId, session.id), eq(orders.status, "pending_approval")));
    if (pending.length > 0) {
      const ids = pending.map((p) => p.id);
      await tx.update(orders).set({ status: "cancelled" }).where(inArray(orders.id, ids));
      await tx
        .update(orderItems)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(inArray(orderItems.orderId, ids), eq(orderItems.status, "pending_approval")));
    }
  });
  ctx.bus.publish(session.venueId, { type: "session.updated", sessionId: session.id, tableId: session.tableId });
}

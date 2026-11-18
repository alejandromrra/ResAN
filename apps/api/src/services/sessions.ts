import { and, eq, inArray, ne } from "drizzle-orm";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { orderItems, orders, serviceCalls, tableSessions } from "../db/schema";
import { isUniqueViolation } from "../lib/errors";
import { assignSession } from "./assignment";

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

export async function closeSession(
  ctx: Ctx,
  session: Pick<SessionRow, "id" | "venueId" | "tableId">,
  reason: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
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

import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { orderItems, orders, tableSessions, venues } from "../db/schema";

/** Momento en que un plato en preparación estará listo (startedAt + minutos de cocina). */
export const dueAt = sql<Date>`${orderItems.startedAt} + coalesce(${orderItems.prepMinutes}, ${venues.defaultPrepMinutes}) * interval '1 minute'`;

/**
 * Cocina automática: la cocina no toca la pantalla, así que los platos avanzan solos.
 *  1. Lo que entra en cocina empieza a prepararse al momento.
 *  2. Cuando se cumplen sus minutos de cocina, pasa a «listo» y sala recibe el aviso.
 */
export async function advanceKitchen(ctx: Ctx, now = new Date()): Promise<number> {
  const touched = new Map<string, string>(); // sessionId → venueId

  // 1. Por si algo quedó como «nuevo» (pedidos antiguos o aprobados por otra vía)
  const fresh = await ctx.db
    .select({ id: orderItems.id, sessionId: orderItems.sessionId, venueId: orderItems.venueId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orderItems.sessionId))
    .where(and(eq(orderItems.fulfillment, "kitchen"), eq(orderItems.status, "new"), eq(orders.status, "accepted"), ne(tableSessions.status, "closed")));
  if (fresh.length) {
    await ctx.db
      .update(orderItems)
      .set({ status: "preparing", startedAt: now, updatedAt: now })
      .where(and(inArray(orderItems.id, fresh.map((f) => f.id)), eq(orderItems.status, "new")));
    for (const f of fresh) touched.set(f.sessionId, f.venueId);
  }

  // 2. Lo que ha cumplido su tiempo pasa a listo (con la hora prevista, aunque el reloj vaya con retraso)
  const due = await ctx.db
    .select({ id: orderItems.id, sessionId: orderItems.sessionId, venueId: orderItems.venueId, due: dueAt })
    .from(orderItems)
    .innerJoin(venues, eq(venues.id, orderItems.venueId))
    .where(and(eq(orderItems.status, "preparing"), eq(orderItems.fulfillment, "kitchen"), lte(dueAt, now)));
  for (const d of due) {
    const readyAt = new Date(Math.min(new Date(d.due).getTime(), now.getTime()));
    await ctx.db
      .update(orderItems)
      .set({ status: "ready", readyAt, updatedAt: now })
      .where(and(eq(orderItems.id, d.id), eq(orderItems.status, "preparing")));
    touched.set(d.sessionId, d.venueId);
  }

  for (const [sessionId, venueId] of touched) ctx.bus.publish(venueId, { type: "item.status", sessionId });
  return fresh.length + due.length;
}

/** Revisa la cocina cada 5 s. Devuelve la función para pararlo. */
export function startKitchenJob(ctx: Ctx, log: (msg: string) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await advanceKitchen(ctx);
    } catch (e) {
      log(`error en la cocina automática: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5_000);
  void tick();
  return () => clearInterval(timer);
}

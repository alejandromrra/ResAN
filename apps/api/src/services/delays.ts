import { and, eq, inArray, ne } from "drizzle-orm";
import { DELAY_AUDIENCE, DELAY_THRESHOLDS as T, type DelayDTO, type DelayKind } from "@resan/shared";
import type { Db } from "../db";
import { orderItems, orders, serviceCalls, tableSessions, tables, users } from "../db/schema";

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));

/**
 * Retrasos activos del local, del más grave al más leve. Se calculan al vuelo a partir de
 * las marcas de tiempo de pedidos, platos y llamadas.
 */
export async function computeDelays(db: Db, venueId: string, now = new Date()): Promise<DelayDTO[]> {
  const sessions = await db
    .select({ id: tableSessions.id, label: tables.label, assigneeId: tableSessions.assignedTo, assigneeName: users.name })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .leftJoin(users, eq(users.id, tableSessions.assignedTo))
    .where(and(eq(tableSessions.venueId, venueId), ne(tableSessions.status, "closed")));
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const bySession = new Map(sessions.map((s) => [s.id, s]));

  const [items, calls] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        sessionId: orderItems.sessionId,
        orderId: orderItems.orderId,
        name: orderItems.nameSnapshot,
        qty: orderItems.qty,
        status: orderItems.status,
        fulfillment: orderItems.fulfillment,
        readyAt: orderItems.readyAt,
        updatedAt: orderItems.updatedAt,
        orderedAt: orders.createdAt,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(inArray(orderItems.sessionId, ids), inArray(orderItems.status, ["pending_approval", "new", "preparing", "ready"]))),
    db
      .select({ sessionId: serviceCalls.sessionId, type: serviceCalls.type, createdAt: serviceCalls.createdAt })
      .from(serviceCalls)
      .where(and(inArray(serviceCalls.sessionId, ids), eq(serviceCalls.status, "open"))),
  ]);

  const out: DelayDTO[] = [];
  const push = (kind: DelayKind, sessionId: string, since: Date, item?: { id: string; name: string; qty: number }) => {
    const s = bySession.get(sessionId)!;
    out.push({
      kind,
      audience: DELAY_AUDIENCE[kind],
      sessionId,
      tableLabel: s.label,
      assigneeId: s.assigneeId,
      assigneeName: s.assigneeName,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      qty: item?.qty ?? null,
      minutes: minutesBetween(since, now),
      since: since.toISOString(),
    });
  };

  const pendingOrders = new Map<string, { sessionId: string; at: Date }>();
  const openOrders = new Map<string, { sessionId: string; at: Date }>();
  for (const i of items) {
    const sinceOrder = minutesBetween(i.orderedAt, now);
    if (i.status === "pending_approval") {
      pendingOrders.set(i.orderId, { sessionId: i.sessionId, at: i.orderedAt });
      continue;
    }
    openOrders.set(i.orderId, { sessionId: i.sessionId, at: i.orderedAt });
    if (i.fulfillment === "kitchen") {
      if (i.status === "ready") {
        const readyAt = i.readyAt ?? i.updatedAt;
        if (minutesBetween(readyAt, now) >= T.readyNotServed) push("ready_not_served", i.sessionId, readyAt, i);
      } else if (sinceOrder >= T.kitchenSlow) {
        push("kitchen_slow", i.sessionId, i.orderedAt, i);
      } else if (i.status === "new" && sinceOrder >= T.kitchenNotStarted) {
        push("kitchen_not_started", i.sessionId, i.orderedAt, i);
      }
    } else if (i.status === "new" && sinceOrder >= T.drinkNotServed) {
      push("drink_not_served", i.sessionId, i.orderedAt, i);
    }
  }
  for (const o of pendingOrders.values()) {
    if (minutesBetween(o.at, now) >= T.approvalPending) push("approval_pending", o.sessionId, o.at);
  }
  for (const o of openOrders.values()) {
    if (minutesBetween(o.at, now) >= T.orderOpen) push("order_open", o.sessionId, o.at);
  }
  for (const c of calls) {
    if (minutesBetween(c.createdAt, now) >= T.callUnanswered) push("call_unanswered", c.sessionId, c.createdAt);
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

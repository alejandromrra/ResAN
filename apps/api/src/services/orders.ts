import { and, eq, inArray, sql } from "drizzle-orm";
import { canTransition, type ItemStatus, type Role } from "@resan/shared";
import type { Ctx } from "../context";
import { items, orderItems, orders, tableSessions } from "../db/schema";
import { audit } from "../lib/audit";
import { conflict, forbidden, gone, notFound, unprocessable } from "../lib/errors";
import { itemNames, type VenueRow } from "./menu";

export const MAX_LINES_PER_ORDER = 30;
export const MAX_QTY_PER_LINE = 20;

export interface NewOrderInput {
  venue: VenueRow;
  sessionId: string;
  guestId?: string | null;
  source: "qr" | "waiter";
  createdBy?: string | null;
  items: { itemId: string; qty: number; note?: string | null }[];
  idempotencyKey?: string | null;
}

export interface NewOrderResult {
  orderId: string;
  round: number;
  status: "pending_approval" | "accepted" | "cancelled";
  duplicate: boolean;
}

export async function createOrder(ctx: Ctx, input: NewOrderInput): Promise<NewOrderResult> {
  const { venue } = input;

  if (input.items.length === 0 || input.items.length > MAX_LINES_PER_ORDER) {
    throw unprocessable("invalid_line_count");
  }

  const result = await ctx.db.transaction(async (tx) => {
    // Bloquea la sesión: serializa pedidos simultáneos de la misma mesa (rondas y duplicados).
    const [session] = await tx
      .select()
      .from(tableSessions)
      .where(and(eq(tableSessions.id, input.sessionId), eq(tableSessions.venueId, venue.id)))
      .for("update");
    if (!session) throw notFound("session_not_found");
    if (session.status === "closed") throw gone("session_closed");

    if (input.idempotencyKey) {
      const [dup] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.venueId, venue.id), eq(orders.idempotencyKey, input.idempotencyKey)));
      if (dup) return { orderId: dup.id, round: dup.round, status: dup.status, duplicate: true };
    }

    const ids = [...new Set(input.items.map((i) => i.itemId))];
    const rows = await tx
      .select()
      .from(items)
      .where(and(eq(items.venueId, venue.id), inArray(items.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const line of input.items) {
      const item = byId.get(line.itemId);
      if (!item || !item.active) throw unprocessable("item_not_found", { itemId: line.itemId });
      if (!item.available) throw unprocessable("item_unavailable", { itemId: line.itemId });
    }

    const names = await itemNames(tx, venue.id, ids, venue.defaultLanguage, venue.defaultLanguage);
    const [{ max } = { max: 0 }] = await tx
      .select({ max: sql<number>`coalesce(max(${orders.round}), 0)` })
      .from(orders)
      .where(eq(orders.sessionId, session.id));
    const round = Number(max) + 1;

    const needsApproval = input.source === "qr" && venue.orderMode === "approval";
    const [order] = await tx
      .insert(orders)
      .values({
        venueId: venue.id,
        sessionId: session.id,
        guestId: input.guestId ?? null,
        source: input.source,
        round,
        status: needsApproval ? "pending_approval" : "accepted",
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    await tx.insert(orderItems).values(
      input.items.map((line) => {
        const item = byId.get(line.itemId)!;
        return {
          venueId: venue.id,
          orderId: order!.id,
          sessionId: session.id,
          guestId: input.guestId ?? null,
          itemId: item.id,
          nameSnapshot: names.get(item.id) ?? "",
          unitCentsSnapshot: item.priceCents,
          vatRateBpSnapshot: item.vatRateBp,
          qty: line.qty,
          note: line.note?.trim() ? line.note.trim() : null,
          fulfillment: item.fulfillment,
          status: (needsApproval ? "pending_approval" : "new") as ItemStatus,
        };
      }),
    );

    return { orderId: order!.id, round, status: order!.status, duplicate: false };
  });

  if (!result.duplicate) {
    ctx.bus.publish(venue.id, { type: "order.created", sessionId: input.sessionId });
  }
  return result;
}

export async function setOrderApproval(
  ctx: Ctx,
  args: { venueId: string; orderId: string; approve: boolean; userId: string },
): Promise<void> {
  const sessionId = await ctx.db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, args.orderId), eq(orders.venueId, args.venueId)))
      .for("update");
    if (!order) throw notFound("order_not_found");
    if (order.status !== "pending_approval") throw conflict("order_not_pending");

    await tx
      .update(orders)
      .set({ status: args.approve ? "accepted" : "cancelled" })
      .where(eq(orders.id, order.id));
    await tx
      .update(orderItems)
      .set({ status: args.approve ? "new" : "cancelled", updatedAt: new Date() })
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.status, "pending_approval")));
    return order.sessionId;
  });

  await audit(ctx.db, {
    venueId: args.venueId,
    userId: args.userId,
    action: args.approve ? "order.approve" : "order.reject",
    entity: "order",
    entityId: args.orderId,
  });
  ctx.bus.publish(args.venueId, { type: "order.updated", sessionId });
}

export async function updateItemStatus(
  ctx: Ctx,
  args: { venueId: string; userId: string; role: Role; ids: string[]; to: ItemStatus },
): Promise<void> {
  const uniqueIds = [...new Set(args.ids)];
  const sessions = new Set<string>();
  const cancelled: string[] = [];

  await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.venueId, args.venueId), inArray(orderItems.id, uniqueIds)))
      .for("update");
    if (rows.length !== uniqueIds.length) throw notFound("item_not_found");

    for (const row of rows) {
      if (row.status === args.to) continue; // idempotente: doble toque
      if (!canTransition(args.role, row.fulfillment, row.status, args.to)) {
        throw forbidden("transition_not_allowed", { itemId: row.id, from: row.status, to: args.to });
      }
      const now = new Date();
      // Marcas de tiempo y autor de cada paso (retrasos y estadísticas por empleado)
      const stamps: Partial<typeof orderItems.$inferInsert> =
        args.to === "preparing"
          ? { startedAt: row.startedAt ?? now, readyAt: null, preparedBy: null }
          : args.to === "ready"
            ? { readyAt: now, preparedBy: args.userId, startedAt: row.startedAt ?? now, servedAt: null, servedBy: null }
            : args.to === "served"
              ? { servedAt: now, servedBy: args.userId }
              : args.to === "new"
                ? { startedAt: null, readyAt: null, servedAt: null, preparedBy: null, servedBy: null }
                : {};
      await tx
        .update(orderItems)
        .set({ status: args.to, updatedAt: now, ...stamps })
        .where(eq(orderItems.id, row.id));
      sessions.add(row.sessionId);
      if (args.to === "cancelled") cancelled.push(row.id);
    }
  });

  if (cancelled.length > 0) {
    await audit(ctx.db, {
      venueId: args.venueId,
      userId: args.userId,
      action: "item.cancel",
      entity: "order_item",
      data: { ids: cancelled },
    });
  }
  for (const sessionId of sessions) {
    ctx.bus.publish(args.venueId, { type: "item.status", sessionId });
  }
}

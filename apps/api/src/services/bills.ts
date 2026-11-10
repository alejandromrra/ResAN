import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BillDTO, BillLineDTO, PaymentMethod } from "@resan/shared";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { bills, guests, orderItems, orders, payments, tableSessions, tables, venues } from "../db/schema";
import { audit } from "../lib/audit";
import { conflict, notFound, unprocessable } from "../lib/errors";
import { closeSession } from "./sessions";

const BILLABLE = ["new", "preparing", "ready", "served"] as const;

export async function loadBillableLines(db: Db, sessionId: string): Promise<BillLineDTO[]> {
  const rows = await db
    .select({
      guestId: orderItems.guestId,
      guestAlias: guests.alias,
      name: orderItems.nameSnapshot,
      qty: orderItems.qty,
      unit: orderItems.unitCentsSnapshot,
      round: orders.round,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(guests, eq(guests.id, orderItems.guestId))
    .where(and(eq(orderItems.sessionId, sessionId), inArray(orderItems.status, [...BILLABLE])))
    .orderBy(asc(orders.round), asc(orderItems.id));
  return rows.map((r) => ({
    guestId: r.guestId,
    guestAlias: r.guestAlias,
    name: r.name,
    qty: r.qty,
    unitCents: r.unit,
    totalCents: r.unit * r.qty,
  }));
}

export const sumLines = (lines: BillLineDTO[]) => lines.reduce((acc, l) => acc + l.totalCents, 0);

export async function toBillDTO(db: Db, bill: typeof bills.$inferSelect): Promise<BillDTO> {
  const [pay] = await db
    .select({
      paid: sql<string>`coalesce(sum(${payments.amountCents}), 0)`,
      tip: sql<string>`coalesce(sum(${payments.tipCents}), 0)`,
    })
    .from(payments)
    .where(eq(payments.billId, bill.id));
  const [ctxRow] = await db
    .select({ label: tables.label, venueName: venues.name })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(venues, eq(venues.id, tableSessions.venueId))
    .where(eq(tableSessions.id, bill.sessionId));

  const lines = bill.lines as BillLineDTO[];
  const grouped = new Map<string, { guestId: string | null; alias: string | null; totalCents: number }>();
  for (const l of lines) {
    const k = l.guestId ?? "none";
    const g = grouped.get(k) ?? { guestId: l.guestId, alias: l.guestAlias, totalCents: 0 };
    g.totalCents += l.totalCents;
    grouped.set(k, g);
  }

  return {
    id: bill.id,
    status: bill.status,
    subtotalCents: bill.subtotalCents,
    discountCents: bill.discountCents,
    totalCents: bill.totalCents,
    paidCents: Number(pay?.paid ?? 0),
    tipCents: Number(pay?.tip ?? 0),
    lines,
    byGuest: [...grouped.values()],
    createdAt: bill.createdAt.toISOString(),
    tableLabel: ctxRow?.label ?? "",
    venueName: ctxRow?.venueName ?? "",
  };
}

export async function latestBill(db: Db, sessionId: string) {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.sessionId, sessionId))
    .orderBy(desc(bills.createdAt))
    .limit(1);
  return bill;
}

/**
 * Genera la cuenta de la sesión. Si ya hay una sin cobros, se recalcula en
 * lugar de crear otra. La cuenta es un documento de consulta, no fiscal.
 */
export async function generateBill(
  ctx: Ctx,
  args: { venueId: string; sessionId: string; userId: string; discountCents: number },
): Promise<BillDTO> {
  const bill = await ctx.db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(tableSessions)
      .where(and(eq(tableSessions.id, args.sessionId), eq(tableSessions.venueId, args.venueId)))
      .for("update");
    if (!session) throw notFound("session_not_found");
    if (session.status === "closed") throw conflict("session_closed");

    const lines = await loadBillableLines(tx, session.id);
    if (lines.length === 0) throw conflict("nothing_to_bill");
    const subtotal = sumLines(lines);
    if (args.discountCents < 0 || args.discountCents > subtotal) throw unprocessable("invalid_discount");
    const total = subtotal - args.discountCents;

    const existing = await latestBill(tx, session.id);
    if (existing && existing.status !== "paid") {
      const [paidRow] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(payments)
        .where(eq(payments.billId, existing.id));
      if (Number(paidRow?.n ?? 0) > 0) throw conflict("bill_has_payments");
      const [updated] = await tx
        .update(bills)
        .set({ lines, subtotalCents: subtotal, discountCents: args.discountCents, totalCents: total, status: "draft" })
        .where(eq(bills.id, existing.id))
        .returning();
      return updated!;
    }

    const [created] = await tx
      .insert(bills)
      .values({
        venueId: args.venueId,
        sessionId: session.id,
        subtotalCents: subtotal,
        discountCents: args.discountCents,
        totalCents: total,
        lines,
        createdBy: args.userId,
      })
      .returning();
    return created!;
  });

  await audit(ctx.db, {
    venueId: args.venueId,
    userId: args.userId,
    action: "bill.generate",
    entity: "bill",
    entityId: bill.id,
    data: { totalCents: bill.totalCents, discountCents: bill.discountCents },
  });
  ctx.bus.publish(args.venueId, { type: "session.updated", sessionId: args.sessionId });
  return toBillDTO(ctx.db, bill);
}

export async function markBillPrinted(ctx: Ctx, venueId: string, billId: string): Promise<BillDTO> {
  const [bill] = await ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.id, billId), eq(bills.venueId, venueId)));
  if (!bill) throw notFound("bill_not_found");
  if (bill.status === "paid") return toBillDTO(ctx.db, bill);
  const [updated] = await ctx.db.update(bills).set({ status: "printed" }).where(eq(bills.id, bill.id)).returning();
  ctx.bus.publish(venueId, { type: "session.updated", sessionId: bill.sessionId });
  return toBillDTO(ctx.db, updated!);
}

/**
 * Registra un cobro hecho fuera de la plataforma (efectivo o datáfono). Cuando
 * lo cobrado cubre la cuenta, la cuenta queda pagada y la mesa se cierra.
 */
export async function registerPayment(
  ctx: Ctx,
  args: {
    venueId: string;
    billId: string;
    userId: string;
    method: PaymentMethod;
    amountCents: number;
    tipCents: number;
  },
): Promise<BillDTO> {
  const { sessionRef, paidAll, bill } = await ctx.db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(bills)
      .where(and(eq(bills.id, args.billId), eq(bills.venueId, args.venueId)))
      .for("update");
    if (!bill) throw notFound("bill_not_found");
    if (bill.status === "paid") throw conflict("bill_already_paid");

    // Si se pidió algo después de generar la cuenta, hay que regenerarla antes de cobrar
    const current = sumLines(await loadBillableLines(tx, bill.sessionId));
    if (current !== bill.subtotalCents) throw conflict("bill_outdated");

    const [row] = await tx
      .select({ paid: sql<string>`coalesce(sum(${payments.amountCents}), 0)` })
      .from(payments)
      .where(eq(payments.billId, bill.id));
    const due = bill.totalCents - Number(row?.paid ?? 0);
    if (args.amountCents <= 0 || args.amountCents > due) throw unprocessable("amount_exceeds_due", { dueCents: due });

    await tx.insert(payments).values({
      venueId: args.venueId,
      billId: bill.id,
      method: args.method,
      amountCents: args.amountCents,
      tipCents: args.tipCents,
      registeredBy: args.userId,
    });

    const paidAll = args.amountCents === due;
    if (paidAll) await tx.update(bills).set({ status: "paid" }).where(eq(bills.id, bill.id));

    const [session] = await tx.select().from(tableSessions).where(eq(tableSessions.id, bill.sessionId));
    return { sessionRef: session!, paidAll, bill };
  });

  await audit(ctx.db, {
    venueId: args.venueId,
    userId: args.userId,
    action: "payment.register",
    entity: "bill",
    entityId: bill.id,
    data: { method: args.method, amountCents: args.amountCents, tipCents: args.tipCents },
  });

  if (paidAll) await closeSession(ctx, sessionRef, "paid");
  else ctx.bus.publish(args.venueId, { type: "session.updated", sessionId: bill.sessionId });

  const [fresh] = await ctx.db.select().from(bills).where(eq(bills.id, bill.id));
  return toBillDTO(ctx.db, fresh!);
}

import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { PAYMENT_METHODS, type CashDTO, type PaymentMethod, type ShiftDTO, type ShiftStateDTO, type StatsDTO } from "@resan/shared";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { bills, payments, shifts, tableSessions, tables, users } from "../db/schema";
import { conflict, isUniqueViolation, notFound } from "../lib/errors";
import { closeAllOpenSessions } from "./sessions";
import { venueStats } from "./stats";

type ShiftRow = typeof shifts.$inferSelect;

async function toDTO(db: Db, row: ShiftRow): Promise<ShiftDTO> {
  const ids = [row.openedBy, row.closedBy].filter((x): x is string => !!x);
  const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const nameOf = (id: string | null) => (id ? (names.find((n) => n.id === id)?.name ?? null) : null);
  return {
    id: row.id,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    openedBy: nameOf(row.openedBy),
    closedBy: nameOf(row.closedBy),
  };
}

export async function currentShift(db: Db, venueId: string): Promise<ShiftRow | undefined> {
  const [row] = await db.select().from(shifts).where(and(eq(shifts.venueId, venueId), isNull(shifts.closedAt)));
  return row;
}

async function lastClosed(db: Db, venueId: string): Promise<ShiftRow | undefined> {
  const [row] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.venueId, venueId), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.closedAt))
    .limit(1);
  return row?.closedAt ? row : undefined;
}

export async function shiftState(db: Db, venueId: string): Promise<ShiftStateDTO> {
  const [cur, last] = await Promise.all([currentShift(db, venueId), lastClosed(db, venueId)]);
  return { current: cur ? await toDTO(db, cur) : null, last: last ? await toDTO(db, last) : null };
}

/** Sin turno abierto no se abren mesas ni se aceptan pedidos ni llamadas. */
export async function requireOpenShift(db: Db, venueId: string): Promise<void> {
  if (!(await currentShift(db, venueId))) throw conflict("shift_closed");
}

export async function openShift(ctx: Ctx, venueId: string, userId: string | null): Promise<ShiftDTO> {
  if (await currentShift(ctx.db, venueId)) throw conflict("shift_already_open");
  // Un turno nuevo empieza limpio: si quedara alguna mesa abierta de antes, se cierra sin cobrar
  await closeAllOpenSessions(ctx, venueId, "stale_on_shift_open");
  try {
    const [row] = await ctx.db.insert(shifts).values({ venueId, openedBy: userId }).returning();
    ctx.bus.publish(venueId, { type: "shift.updated" });
    return toDTO(ctx.db, row!);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("shift_already_open");
    throw e;
  }
}

/**
 * Cierra el turno y guarda su resumen. Exige que no queden mesas abiertas, para que la caja
 * de cada camarero cuadre con lo cobrado, salvo que se pida cerrarlas sin cobrar (`force`).
 */
export async function closeShift(ctx: Ctx, venueId: string, userId: string, opts: { force?: boolean } = {}): Promise<StatsDTO> {
  const cur = await currentShift(ctx.db, venueId);
  if (!cur) throw conflict("shift_closed");
  // Con force, las mesas que queden abiertas se cierran sin cobrar (queda registrado)
  if (opts.force) await closeAllOpenSessions(ctx, venueId, "shift_close_forced");
  const open = await ctx.db
    .select({ label: tables.label })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(and(eq(tableSessions.venueId, venueId), ne(tableSessions.status, "closed")));
  if (open.length) throw conflict("open_tables", { tables: open.map((o) => o.label) });

  const closedAt = new Date();
  const closedRow = { ...cur, closedAt, closedBy: userId };
  const summary = await venueStats(ctx, venueId, { start: cur.openedAt, end: closedAt, live: false, shift: await toDTO(ctx.db, closedRow) });
  const updated = await ctx.db
    .update(shifts)
    .set({ closedAt, closedBy: userId, summary })
    .where(and(eq(shifts.id, cur.id), isNull(shifts.closedAt)))
    .returning({ id: shifts.id });
  if (!updated.length) throw conflict("shift_closed");
  ctx.bus.publish(venueId, { type: "shift.updated" });
  return summary;
}

export async function listShifts(db: Db, venueId: string, limit = 60): Promise<ShiftDTO[]> {
  const rows = await db.select().from(shifts).where(eq(shifts.venueId, venueId)).orderBy(desc(shifts.openedAt)).limit(limit);
  return Promise.all(rows.map((r) => toDTO(db, r)));
}

/**
 * Estadísticas de un turno: el abierto (en vivo) o uno cerrado (su resumen guardado).
 * Sin `shiftId`: el abierto si lo hay, si no el último cerrado.
 */
export async function shiftStats(ctx: Ctx, venueId: string, shiftId?: string): Promise<StatsDTO> {
  let row: ShiftRow | undefined;
  if (shiftId) {
    [row] = await ctx.db.select().from(shifts).where(and(eq(shifts.id, shiftId), eq(shifts.venueId, venueId)));
  } else {
    row = (await currentShift(ctx.db, venueId)) ?? (await lastClosed(ctx.db, venueId));
  }
  if (!row) throw notFound("no_shift");
  if (row.closedAt && row.summary) return row.summary as StatsDTO;
  return venueStats(ctx, venueId, { start: row.openedAt, end: row.closedAt ?? new Date(), live: !row.closedAt, shift: await toDTO(ctx.db, row) });
}

const zero = () => Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;

/** Caja de un camarero en el turno abierto (o el último cerrado): cobros por forma de pago y propinas. */
export async function cashFor(ctx: Ctx, venueId: string, userId: string, shiftId?: string): Promise<CashDTO> {
  let row: ShiftRow | undefined;
  if (shiftId) [row] = await ctx.db.select().from(shifts).where(and(eq(shifts.id, shiftId), eq(shifts.venueId, venueId)));
  else row = (await currentShift(ctx.db, venueId)) ?? (await lastClosed(ctx.db, venueId));
  if (!row) throw notFound("no_shift");
  const end = row.closedAt ?? new Date();
  const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  const rows = await ctx.db
    .select({ label: tables.label, method: payments.method, amount: payments.amountCents, tip: payments.tipCents, at: payments.createdAt })
    .from(payments)
    .innerJoin(bills, eq(bills.id, payments.billId))
    .innerJoin(tableSessions, eq(tableSessions.id, bills.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(and(eq(payments.venueId, venueId), eq(payments.registeredBy, userId), gte(payments.createdAt, row.openedAt), lte(payments.createdAt, end)))
    .orderBy(payments.createdAt);
  const byMethod = zero();
  const tipsByMethod = zero();
  for (const r of rows) {
    byMethod[r.method] += r.amount;
    tipsByMethod[r.method] += r.tip;
  }
  return {
    shift: await toDTO(ctx.db, row),
    userId,
    name: me?.name ?? "",
    payments: rows.map((r) => ({ tableLabel: r.label, method: r.method, amountCents: r.amount, tipCents: r.tip, at: r.at.toISOString() })),
    byMethod,
    tipsByMethod,
    totalCents: rows.reduce((n, r) => n + r.amount, 0),
    tipsCents: rows.reduce((n, r) => n + r.tip, 0),
  };
}

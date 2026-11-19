import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { CLAIM_TIMEOUT_MIN, type AssignMode, type TableOfferDTO, type WaiterLoadDTO } from "@resan/shared";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { memberships, tableAssignments, tableSessions, tables, users, venues, zoneStaff } from "../db/schema";
import { conflict, notFound, unprocessable } from "../lib/errors";

const OPEN = ne(tableSessions.status, "closed");

/** Camareros del local con las mesas abiertas que llevan y si están conectados ahora. */
export async function waiterLoads(ctx: Ctx, venueId: string): Promise<WaiterLoadDTO[]> {
  const [waiters, counts] = await Promise.all([
    ctx.db
      .select({ userId: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.venueId, venueId), eq(memberships.role, "waiter"))),
    ctx.db
      .select({ userId: tableSessions.assignedTo, n: sql<number>`count(*)::int` })
      .from(tableSessions)
      .where(and(eq(tableSessions.venueId, venueId), OPEN))
      .groupBy(tableSessions.assignedTo),
  ]);
  const zonesOf = await zoneMap(ctx.db, venueId);
  const online = ctx.bus.online(venueId);
  const byUser = new Map(counts.map((c) => [c.userId, Number(c.n)]));
  return waiters
    .map((w) => ({
      userId: w.userId,
      name: w.name,
      online: online.has(w.userId),
      openTables: byUser.get(w.userId) ?? 0,
      zoneIds: [...zonesOf.entries()].filter(([, us]) => us.includes(w.userId)).map(([z]) => z),
    }))
    .sort((a, b) => a.openTables - b.openTables || a.name.localeCompare(b.name));
}

/** zoneId → camareros responsables. */
export async function zoneMap(db: Db, venueId: string): Promise<Map<string, string[]>> {
  const rows = await db.select({ zoneId: zoneStaff.zoneId, userId: zoneStaff.userId }).from(zoneStaff).where(eq(zoneStaff.venueId, venueId));
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.zoneId, [...(m.get(r.zoneId) ?? []), r.userId]);
  return m;
}

async function assignsByZone(db: Db, venueId: string): Promise<boolean> {
  const [v] = await db.select({ on: venues.assignByZone }).from(venues).where(eq(venues.id, venueId));
  return !!v?.on;
}

/**
 * A quién se ofrece una mesa: con asignación por zonas, a los camareros de su zona;
 * si la zona no tiene a nadie (o no se usa), a todo el equipo de sala.
 */
function poolFor(loads: WaiterLoadDTO[], zoneId: string | null, byZone: boolean): WaiterLoadDTO[] {
  if (byZone && zoneId) {
    const inZone = loads.filter((l) => l.zoneIds.includes(zoneId));
    if (inZone.length) return inZone;
  }
  return loads;
}

/**
 * Con asignación por zonas, da la mesa al camarero conectado de su zona que menos mesas lleva.
 * Si no hay nadie de la zona conectado, la mesa sigue el flujo normal (aviso y asignación a los 5 min).
 */
export async function assignToZone(ctx: Ctx, venueId: string, sessionId: string): Promise<boolean> {
  if (!(await assignsByZone(ctx.db, venueId))) return false;
  const [s] = await ctx.db
    .select({ zoneId: tables.zoneId, assignedTo: tableSessions.assignedTo })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(and(eq(tableSessions.id, sessionId), OPEN));
  if (!s || s.assignedTo || !s.zoneId) return false;
  const loads = await waiterLoads(ctx, venueId);
  const online = loads.filter((l) => l.online && l.zoneIds.includes(s.zoneId!));
  if (!online.length) return false;
  const pick = leastBusy(online)[0]!;
  return assignSession(ctx, { venueId, sessionId, userId: pick.userId, mode: "zone", by: null, onlyIfUnassigned: true });
}

/**
 * Los camareros menos ocupados: entre los conectados (o todos, si no hay nadie conectado),
 * los que llevan menos mesas abiertas.
 */
export function leastBusy(loads: WaiterLoadDTO[]): WaiterLoadDTO[] {
  const online = loads.filter((l) => l.online);
  const pool = online.length ? online : loads;
  if (!pool.length) return [];
  const min = Math.min(...pool.map((l) => l.openTables));
  return pool.filter((l) => l.openTables === min);
}

/**
 * Asigna una mesa. Con `onlyIfUnassigned` la asignación solo se hace si nadie la tiene
 * (para «coger» una mesa o la asignación automática sin pisar a otro camarero).
 */
export async function assignSession(
  ctx: Ctx,
  args: { venueId: string; sessionId: string; userId: string; mode: AssignMode; by: string | null; onlyIfUnassigned?: boolean },
): Promise<boolean> {
  const now = new Date();
  const done = await ctx.db.transaction(async (tx) => {
    const updated = await tx
      .update(tableSessions)
      .set({ assignedTo: args.userId, assignedAt: now, assignMode: args.mode })
      .where(
        and(
          eq(tableSessions.id, args.sessionId),
          eq(tableSessions.venueId, args.venueId),
          OPEN,
          ...(args.onlyIfUnassigned ? [isNull(tableSessions.assignedTo)] : []),
        ),
      )
      .returning({ openedAt: tableSessions.openedAt, tableId: tableSessions.tableId });
    const row = updated[0];
    if (!row) return null;
    await tx.insert(tableAssignments).values({
      venueId: args.venueId,
      sessionId: args.sessionId,
      userId: args.userId,
      mode: args.mode,
      assignedBy: args.by,
      waitSeconds: Math.max(0, Math.round((now.getTime() - row.openedAt.getTime()) / 1000)),
    });
    return row;
  });
  if (done) ctx.bus.publish(args.venueId, { type: "assignment.updated", sessionId: args.sessionId, tableId: done.tableId });
  return !!done;
}

/** Un camarero coge una mesa que aún no tiene a nadie. */
export async function claimSession(ctx: Ctx, args: { venueId: string; sessionId: string; userId: string }) {
  const ok = await assignSession(ctx, { ...args, mode: "claimed", by: args.userId, onlyIfUnassigned: true });
  if (ok) return;
  const [s] = await ctx.db
    .select({ status: tableSessions.status, assignedTo: tableSessions.assignedTo })
    .from(tableSessions)
    .where(and(eq(tableSessions.id, args.sessionId), eq(tableSessions.venueId, args.venueId)));
  if (!s) throw notFound("session_not_found");
  if (s.status === "closed") throw conflict("session_closed");
  if (s.assignedTo === args.userId) return;
  throw conflict("already_assigned");
}

/** El encargado asigna o reasigna una mesa a alguien del equipo de sala. */
export async function reassignSession(ctx: Ctx, args: { venueId: string; sessionId: string; userId: string; by: string }) {
  const [m] = await ctx.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.venueId, args.venueId), eq(memberships.userId, args.userId)));
  if (!m) throw notFound("user_not_found");
  if (m.role === "kitchen") throw unprocessable("not_floor_staff");
  const ok = await assignSession(ctx, { ...args, mode: "manager" });
  if (!ok) throw notFound("session_not_found");
}

/** Mesas abiertas por clientes sin camarero; `offeredToMe` si el usuario está entre los menos ocupados. */
export async function tableOffers(ctx: Ctx, venueId: string, userId: string, loads?: WaiterLoadDTO[]): Promise<TableOfferDTO[]> {
  const rows = await ctx.db
    .select({ sessionId: tableSessions.id, tableId: tables.id, zoneId: tables.zoneId, label: tables.label, openedAt: tableSessions.openedAt })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(and(eq(tableSessions.venueId, venueId), OPEN, isNull(tableSessions.assignedTo)))
    .orderBy(tableSessions.openedAt);
  if (!rows.length) return [];
  const all = loads ?? (await waiterLoads(ctx, venueId));
  const byZone = await assignsByZone(ctx.db, venueId);
  return rows.map((r) => ({
    sessionId: r.sessionId,
    tableId: r.tableId,
    tableLabel: r.label,
    openedAt: r.openedAt.toISOString(),
    autoAssignAt: new Date(r.openedAt.getTime() + CLAIM_TIMEOUT_MIN * 60_000).toISOString(),
    offeredToMe: leastBusy(poolFor(all, r.zoneId, byZone)).some((l) => l.userId === userId),
  }));
}

/**
 * Asigna sola cada mesa que lleva más de CLAIM_TIMEOUT_MIN minutos sin camarero: al que
 * menos mesas lleva (entre los conectados; si no hay ninguno, entre todos). A igualdad,
 * al que menos mesas ha recibido hoy.
 */
export async function autoAssignExpired(ctx: Ctx, now = new Date()): Promise<number> {
  let assigned = 0;
  // Asignación por zonas: en cuanto haya alguien de la zona conectado
  const unassigned = await ctx.db
    .select({ id: tableSessions.id, venueId: tableSessions.venueId })
    .from(tableSessions)
    .innerJoin(venues, eq(venues.id, tableSessions.venueId))
    .where(and(OPEN, isNull(tableSessions.assignedTo), eq(venues.assignByZone, true)));
  for (const s of unassigned) if (await assignToZone(ctx, s.venueId, s.id)) assigned++;

  const limit = new Date(now.getTime() - CLAIM_TIMEOUT_MIN * 60_000);
  const pending = await ctx.db
    .select({ id: tableSessions.id, venueId: tableSessions.venueId, zoneId: tables.zoneId, byZone: venues.assignByZone })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .innerJoin(venues, eq(venues.id, tableSessions.venueId))
    .where(and(OPEN, isNull(tableSessions.assignedTo), lt(tableSessions.openedAt, limit)))
    .orderBy(tableSessions.openedAt);
  for (const s of pending) {
    const loads = await waiterLoads(ctx, s.venueId);
    const candidates = leastBusy(poolFor(loads, s.zoneId, s.byZone));
    if (!candidates.length) continue; // local sin camareros: la mesa sigue sin asignar
    const since = new Date(now.getTime() - 24 * 3600_000);
    const today = await ctx.db
      .select({ userId: tableAssignments.userId, n: sql<number>`count(*)::int` })
      .from(tableAssignments)
      .where(
        and(
          eq(tableAssignments.venueId, s.venueId),
          gte(tableAssignments.createdAt, since),
          inArray(tableAssignments.userId, candidates.map((c) => c.userId)),
        ),
      )
      .groupBy(tableAssignments.userId);
    const todayBy = new Map(today.map((t) => [t.userId, Number(t.n)]));
    const pick = [...candidates].sort((a, b) => (todayBy.get(a.userId) ?? 0) - (todayBy.get(b.userId) ?? 0))[0]!;
    if (await assignSession(ctx, { venueId: s.venueId, sessionId: s.id, userId: pick.userId, mode: "auto", by: null, onlyIfUnassigned: true })) {
      assigned++;
    }
  }
  return assigned;
}

/** Comprueba cada 30 s las mesas pendientes de asignar. Devuelve la función para pararlo. */
export function startAssignmentJob(ctx: Ctx, log: (msg: string) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await autoAssignExpired(ctx);
      if (n) log(`${n} mesa(s) asignada(s) automáticamente`);
    } catch (e) {
      log(`error en la asignación automática: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 30_000);
  void tick();
  return () => clearInterval(timer);
}

export type { Db };

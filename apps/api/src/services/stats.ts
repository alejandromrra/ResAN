import { and, eq, gte, isNotNull, lt, ne, or } from "drizzle-orm";
import {
  ASSIGN_MODES,
  DELAY_THRESHOLDS as T,
  type AssignMode,
  type StaffStatsDTO,
  type StatsDTO,
} from "@resan/shared";
import type { Ctx } from "../context";
import { memberships, orderItems, orders, payments, serviceCalls, tableAssignments, tableSessions, users } from "../db/schema";
import { unprocessable } from "../lib/errors";
import { getVenue } from "../lib/venue";
import { computeDelays } from "./delays";

/** Desfase (ms) de una zona horaria respecto a UTC en un instante dado. */
function tzOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
}

/** Medianoche de `date` (AAAA-MM-DD) en la zona horaria del local. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(timeZone, guess);
  return new Date(guess - tzOffsetMs(timeZone, first)); // segunda pasada por si hay cambio de hora
}

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const secs = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 1000);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Estadísticas del día (en la zona horaria del local) por empleado. Si el día es hoy, además
 * incluye el estado en vivo: mesas que lleva cada uno y retrasos activos.
 */
export async function venueStats(ctx: Ctx, venueId: string, date?: string, now = new Date()): Promise<StatsDTO> {
  const venue = await getVenue(ctx, venueId);
  const tz = venue.timezone || "Europe/Madrid";
  const today = todayIn(tz, now);
  const day = date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw unprocessable("invalid_date");
  const start = zonedMidnight(day, tz);
  const next = new Date(start.getTime() + 36 * 3600_000);
  const end = zonedMidnight(todayIn(tz, next), tz);
  const live = day === today;
  const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, start), lt(col, end));
  const db = ctx.db;

  const [staff, assigns, served, prepared, calls, pays, openNow, delays] = await Promise.all([
    db.select({ userId: users.id, name: users.name, role: memberships.role })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.venueId, venueId)),
    db.select({ userId: tableAssignments.userId, mode: tableAssignments.mode, wait: tableAssignments.waitSeconds, sessionId: tableAssignments.sessionId })
      .from(tableAssignments).where(and(eq(tableAssignments.venueId, venueId), inRange(tableAssignments.createdAt))),
    db.select({ by: orderItems.servedBy, at: orderItems.servedAt, readyAt: orderItems.readyAt, fulfillment: orderItems.fulfillment, qty: orderItems.qty, orderedAt: orders.createdAt })
      .from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.venueId, venueId), isNotNull(orderItems.servedBy), inRange(orderItems.servedAt))),
    db.select({ by: orderItems.preparedBy, readyAt: orderItems.readyAt, startedAt: orderItems.startedAt, qty: orderItems.qty, orderedAt: orders.createdAt })
      .from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.venueId, venueId), isNotNull(orderItems.preparedBy), inRange(orderItems.readyAt))),
    db.select({ ackBy: serviceCalls.ackBy, doneBy: serviceCalls.doneBy, createdAt: serviceCalls.createdAt, ackAt: serviceCalls.ackAt, doneAt: serviceCalls.doneAt })
      .from(serviceCalls)
      .where(and(eq(serviceCalls.venueId, venueId), inRange(serviceCalls.createdAt), or(isNotNull(serviceCalls.ackBy), isNotNull(serviceCalls.doneBy)))),
    db.select({ by: payments.registeredBy, amount: payments.amountCents, tip: payments.tipCents })
      .from(payments).where(and(eq(payments.venueId, venueId), inRange(payments.createdAt))),
    live
      ? db.select({ userId: tableSessions.assignedTo }).from(tableSessions)
          .where(and(eq(tableSessions.venueId, venueId), ne(tableSessions.status, "closed")))
      : Promise.resolve([] as { userId: string | null }[]),
    live ? computeDelays(db, venueId, now) : Promise.resolve([]),
  ]);

  const online = live ? ctx.bus.online(venueId) : new Set<string>();
  const kitchenDelays = delays.filter((d) => d.audience === "kitchen").length;

  const rows: StaffStatsDTO[] = staff.map((m) => {
    const mineAssign = assigns.filter((a) => a.userId === m.userId);
    const assignedBy = Object.fromEntries(ASSIGN_MODES.map((k) => [k, mineAssign.filter((a) => a.mode === k).length])) as Record<AssignMode, number>;
    const claimWaits = mineAssign.filter((a) => a.mode === "claimed").map((a) => a.wait);

    const serveTimes = served
      .filter((s) => s.by === m.userId)
      .map((s) => secs(s.fulfillment === "kitchen" ? (s.readyAt ?? s.orderedAt) : s.orderedAt, s.at!));
    const serveLimit = (f: string) => (f === "kitchen" ? T.readyNotServed : T.drinkNotServed) * 60;
    const lateServes = served.filter(
      (s) => s.by === m.userId && secs(s.fulfillment === "kitchen" ? (s.readyAt ?? s.orderedAt) : s.orderedAt, s.at!) > serveLimit(s.fulfillment),
    ).length;

    const myCalls = calls.filter((c) => (c.ackBy ?? c.doneBy) === m.userId);
    const callTimes = myCalls.map((c) => secs(c.createdAt, (c.ackAt ?? c.doneAt)!));
    const lateCalls = callTimes.filter((x) => x > T.callUnanswered * 60).length;

    const myPrep = prepared.filter((p) => p.by === m.userId);
    const startTimes = myPrep.filter((p) => p.startedAt).map((p) => secs(p.orderedAt, p.startedAt!));
    const prepTimes = myPrep.map((p) => secs(p.orderedAt, p.readyAt!));
    const latePrepared = prepTimes.filter((x) => x > T.kitchenSlow * 60).length;

    const myPays = pays.filter((p) => p.by === m.userId);
    const tasks = serveTimes.length + callTimes.length + prepTimes.length;
    const late = lateServes + lateCalls + latePrepared;

    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      online: online.has(m.userId),
      openTables: openNow.filter((o) => o.userId === m.userId).length,
      activeDelays:
        m.role === "kitchen"
          ? (online.has(m.userId) ? kitchenDelays : 0)
          : delays.filter((d) => d.audience === "floor" && d.assigneeId === m.userId).length,
      tablesAssigned: new Set(mineAssign.map((a) => a.sessionId)).size,
      assignedBy,
      avgClaimSeconds: avg(claimWaits),
      itemsServed: served.filter((s) => s.by === m.userId).reduce((n, s) => n + s.qty, 0),
      avgServeSeconds: avg(serveTimes),
      lateServes,
      callsHandled: myCalls.length,
      avgCallSeconds: avg(callTimes),
      lateCalls,
      payments: myPays.length,
      revenueCents: myPays.reduce((n, p) => n + p.amount, 0),
      tipsCents: myPays.reduce((n, p) => n + p.tip, 0),
      itemsPrepared: myPrep.reduce((n, p) => n + p.qty, 0),
      avgStartSeconds: avg(startTimes),
      avgPrepSeconds: avg(prepTimes),
      latePrepared,
      onTimePct: tasks ? Math.round(((tasks - late) / tasks) * 100) : null,
    };
  });

  const allServe = served.map((s) => secs(s.fulfillment === "kitchen" ? (s.readyAt ?? s.orderedAt) : s.orderedAt, s.at!));
  const allPrep = prepared.map((p) => secs(p.orderedAt, p.readyAt!));
  return {
    date: day,
    live,
    timezone: tz,
    totals: {
      tablesServed: new Set(assigns.map((a) => a.sessionId)).size,
      revenueCents: pays.reduce((n, p) => n + p.amount, 0),
      tipsCents: pays.reduce((n, p) => n + p.tip, 0),
      itemsServed: served.reduce((n, s) => n + s.qty, 0),
      avgServeSeconds: avg(allServe),
      avgPrepSeconds: avg(allPrep),
      lateEvents: rows.reduce((n, r) => n + r.lateServes + r.lateCalls + r.latePrepared, 0),
      activeDelays: delays.length,
    },
    // Primero quien ha trabajado; dentro, por puntualidad
    staff: rows.sort((a, b) => {
      const work = (r: StaffStatsDTO) => r.itemsServed + r.itemsPrepared + r.callsHandled + r.tablesAssigned + r.openTables;
      return Number(work(b) > 0) - Number(work(a) > 0) || (b.onTimePct ?? -1) - (a.onTimePct ?? -1) || a.name.localeCompare(b.name);
    }),
  };
}

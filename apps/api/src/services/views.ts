import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  deriveTableStatus,
  type CallDTO,
  type FloorTasksDTO,
  type GuestSessionDTO,
  type KitchenTicketDTO,
  type StaffOrderDTO,
  type StaffSessionDTO,
  type StaffTableDTO,
} from "@resan/shared";
import type { Db } from "../db";
import { bills, guests, orderItems, orders, serviceCalls, tableSessions, tables, users, zones } from "../db/schema";
import { computeDelays } from "./delays";
import { notFound } from "../lib/errors";
import { latestBill, toBillDTO } from "./bills";
import { itemNames, type VenueRow } from "./menu";

const BILLABLE = new Set(["new", "preparing", "ready", "served"]);

const byLabel = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

export async function listTables(db: Db, venueId: string): Promise<StaffTableDTO[]> {
  const rows = await db
    .select({ t: tables, zoneName: zones.name, zoneSort: zones.sort })
    .from(tables)
    .leftJoin(zones, eq(zones.id, tables.zoneId))
    .where(and(eq(tables.venueId, venueId), eq(tables.active, true)));

  const sessions = await db
    .select()
    .from(tableSessions)
    .where(and(eq(tableSessions.venueId, venueId), ne(tableSessions.status, "closed")));
  const sessionIds = sessions.map((s) => s.id);

  const [its, calls, gs, printed] = sessionIds.length
    ? await Promise.all([
        db.select().from(orderItems).where(inArray(orderItems.sessionId, sessionIds)),
        db
          .select()
          .from(serviceCalls)
          .where(and(inArray(serviceCalls.sessionId, sessionIds), eq(serviceCalls.status, "open"))),
        db.select({ id: guests.id, sessionId: guests.sessionId }).from(guests).where(inArray(guests.sessionId, sessionIds)),
        db
          .select({ sessionId: bills.sessionId })
          .from(bills)
          .where(and(inArray(bills.sessionId, sessionIds), eq(bills.status, "printed"))),
      ])
    : [[], [], [], []];

  const sessionByTable = new Map(sessions.map((s) => [s.tableId, s]));
  const assigneeIds = [...new Set(sessions.map((s) => s.assignedTo).filter((x): x is string => !!x))];
  const [names, delays] = await Promise.all([
    assigneeIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeIds)) : [],
    computeDelays(db, venueId),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const worstDelay = new Map<string, number>();
  for (const d of delays) worstDelay.set(d.sessionId, Math.max(worstDelay.get(d.sessionId) ?? 0, d.minutes));

  const dtos = rows.map(({ t, zoneName, zoneSort }) => {
    const s = sessionByTable.get(t.id);
    let status = deriveTableStatus({
      hasOpenSession: false, billRequested: false, waiterCalling: false, billPrinted: false,
      pendingApproval: 0, readyToServe: 0, inProgress: 0,
    });
    let totalCents = 0;
    let guestCount = 0;
    if (s) {
      const mine = its.filter((i) => i.sessionId === s.id);
      const myCalls = calls.filter((c) => c.sessionId === s.id);
      guestCount = gs.filter((g) => g.sessionId === s.id).length;
      totalCents = mine.filter((i) => BILLABLE.has(i.status)).reduce((a, i) => a + i.unitCentsSnapshot * i.qty, 0);
      status = deriveTableStatus({
        hasOpenSession: true,
        billRequested: myCalls.some((c) => c.type === "bill"),
        waiterCalling: myCalls.some((c) => c.type === "waiter"),
        billPrinted: printed.some((p) => p.sessionId === s.id),
        pendingApproval: mine.filter((i) => i.status === "pending_approval").length,
        readyToServe: mine.filter(
          (i) => i.status === "ready" || (i.fulfillment === "serve" && i.status === "new"),
        ).length,
        inProgress: mine.filter((i) => i.fulfillment === "kitchen" && (i.status === "new" || i.status === "preparing")).length,
      });
    }
    return {
      sort: zoneSort ?? 9999,
      dto: {
        id: t.id,
        label: t.label,
        zoneId: t.zoneId,
        zoneName: zoneName ?? null,
        capacity: t.capacity,
        qrToken: t.qrToken,
        status,
        sessionId: s?.id ?? null,
        guestCount,
        totalCents,
        openedAt: s ? s.openedAt.toISOString() : null,
        assignee:
          s?.assignedTo && s.assignMode
            ? { userId: s.assignedTo, name: nameOf.get(s.assignedTo) ?? "—", mode: s.assignMode }
            : null,
        delayMinutes: s ? (worstDelay.get(s.id) ?? 0) : 0,
      } satisfies StaffTableDTO,
    };
  });

  return dtos
    .sort((a, b) => a.sort - b.sort || byLabel(a.dto.label, b.dto.label))
    .map((d) => d.dto);
}

export async function floorTasks(db: Db, venueId: string): Promise<Omit<FloorTasksDTO, "offers" | "delays" | "waiters">> {
  const itemRows = await db
    .select({
      id: orderItems.id,
      sessionId: orderItems.sessionId,
      name: orderItems.nameSnapshot,
      qty: orderItems.qty,
      status: orderItems.status,
      fulfillment: orderItems.fulfillment,
      label: tables.label,
      orderId: orderItems.orderId,
    })
    .from(orderItems)
    .innerJoin(tableSessions, eq(tableSessions.id, orderItems.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(orderItems.venueId, venueId),
        inArray(orderItems.status, ["new", "ready", "pending_approval"]),
      ),
    )
    .orderBy(asc(orderItems.updatedAt));

  const callRows = await db
    .select({
      id: serviceCalls.id,
      type: serviceCalls.type,
      status: serviceCalls.status,
      createdAt: serviceCalls.createdAt,
      sessionId: serviceCalls.sessionId,
      label: tables.label,
    })
    .from(serviceCalls)
    .innerJoin(tableSessions, eq(tableSessions.id, serviceCalls.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(and(eq(serviceCalls.venueId, venueId), ne(serviceCalls.status, "done")))
    .orderBy(asc(serviceCalls.createdAt));

  const approvals = new Map<string, FloorTasksDTO["approvals"][number]>();
  for (const r of itemRows.filter((i) => i.status === "pending_approval")) {
    const a = approvals.get(r.orderId) ?? { orderId: r.orderId, sessionId: r.sessionId, tableLabel: r.label, itemCount: 0 };
    a.itemCount += r.qty;
    approvals.set(r.orderId, a);
  }

  return {
    ready: itemRows
      .filter((i) => i.fulfillment === "kitchen" && i.status === "ready")
      .map((i) => ({ itemId: i.id, sessionId: i.sessionId, tableLabel: i.label, name: i.name, qty: i.qty })),
    serve: itemRows
      .filter((i) => i.fulfillment === "serve" && i.status === "new")
      .map((i) => ({ itemId: i.id, sessionId: i.sessionId, tableLabel: i.label, name: i.name, qty: i.qty })),
    calls: callRows.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      sessionId: c.sessionId,
      tableLabel: c.label,
    })),
    approvals: [...approvals.values()],
  };
}

export async function kitchenTickets(db: Db, venueId: string): Promise<KitchenTicketDTO[]> {
  const rows = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      sessionId: orderItems.sessionId,
      name: orderItems.nameSnapshot,
      qty: orderItems.qty,
      note: orderItems.note,
      status: orderItems.status,
      round: orders.round,
      createdAt: orders.createdAt,
      label: tables.label,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.id, orderItems.sessionId))
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(
      and(
        eq(orderItems.venueId, venueId),
        eq(orderItems.fulfillment, "kitchen"),
        inArray(orderItems.status, ["new", "preparing", "ready"]),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(orderItems.id));

  const map = new Map<string, KitchenTicketDTO>();
  for (const r of rows) {
    const ticket = map.get(r.orderId) ?? {
      orderId: r.orderId,
      sessionId: r.sessionId,
      tableLabel: r.label,
      round: r.round,
      createdAt: r.createdAt.toISOString(),
      items: [],
    };
    ticket.items.push({ id: r.id, name: r.name, qty: r.qty, note: r.note, status: r.status });
    map.set(r.orderId, ticket);
  }
  return [...map.values()];
}

export async function loadStaffSession(db: Db, venueId: string, sessionId: string): Promise<StaffSessionDTO> {
  const [row] = await db
    .select({ s: tableSessions, label: tables.label, assigneeName: users.name })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .leftJoin(users, eq(users.id, tableSessions.assignedTo))
    .where(and(eq(tableSessions.id, sessionId), eq(tableSessions.venueId, venueId)));
  if (!row) throw notFound("session_not_found");

  const [gs, ords, its, calls, bill] = await Promise.all([
    db.select().from(guests).where(eq(guests.sessionId, sessionId)).orderBy(asc(guests.createdAt)),
    db.select().from(orders).where(eq(orders.sessionId, sessionId)).orderBy(asc(orders.round)),
    db.select().from(orderItems).where(eq(orderItems.sessionId, sessionId)).orderBy(asc(orderItems.id)),
    db
      .select()
      .from(serviceCalls)
      .where(and(eq(serviceCalls.sessionId, sessionId), ne(serviceCalls.status, "done")))
      .orderBy(asc(serviceCalls.createdAt)),
    latestBill(db, sessionId),
  ]);

  const alias = new Map(gs.map((g) => [g.id, g.alias]));
  const orderDTOs: StaffOrderDTO[] = ords.map((o) => ({
    id: o.id,
    round: o.round,
    source: o.source,
    status: o.status,
    guestId: o.guestId,
    guestAlias: o.guestId ? (alias.get(o.guestId) ?? null) : null,
    createdAt: o.createdAt.toISOString(),
    items: its
      .filter((i) => i.orderId === o.id)
      .map((i) => ({
        id: i.id,
        orderId: i.orderId,
        guestId: i.guestId,
        guestAlias: i.guestId ? (alias.get(i.guestId) ?? null) : null,
        round: o.round,
        name: i.nameSnapshot,
        qty: i.qty,
        unitCents: i.unitCentsSnapshot,
        note: i.note,
        status: i.status,
        fulfillment: i.fulfillment,
      })),
  }));

  return {
    session: {
      id: row.s.id,
      tableId: row.s.tableId,
      tableLabel: row.label,
      status: row.s.status,
      openedAt: row.s.openedAt.toISOString(),
      assignee:
        row.s.assignedTo && row.s.assignMode
          ? { userId: row.s.assignedTo, name: row.assigneeName ?? "—", mode: row.s.assignMode }
          : null,
    },
    guests: gs.map((g) => ({ id: g.id, alias: g.alias })),
    orders: orderDTOs,
    calls: calls.map(toCallDTO),
    bill: bill ? await toBillDTO(db, bill) : null,
    totalCents: its.filter((i) => BILLABLE.has(i.status)).reduce((a, i) => a + i.unitCentsSnapshot * i.qty, 0),
  };
}

export async function loadGuestSession(
  db: Db,
  venue: VenueRow,
  guest: { id: string; alias: string; language: string; sessionId: string },
): Promise<GuestSessionDTO> {
  const [row] = await db
    .select({ s: tableSessions, label: tables.label })
    .from(tableSessions)
    .innerJoin(tables, eq(tables.id, tableSessions.tableId))
    .where(eq(tableSessions.id, guest.sessionId));
  if (!row) throw notFound("session_not_found");

  const [gs, its, calls] = await Promise.all([
    db.select().from(guests).where(eq(guests.sessionId, guest.sessionId)).orderBy(asc(guests.createdAt)),
    db
      .select({ i: orderItems, round: orders.round })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.sessionId, guest.sessionId), ne(orderItems.status, "cancelled")))
      .orderBy(asc(orders.round), asc(orderItems.id)),
    db
      .select()
      .from(serviceCalls)
      .where(and(eq(serviceCalls.sessionId, guest.sessionId), ne(serviceCalls.status, "done"))),
  ]);

  const ids = [...new Set(its.map((r) => r.i.itemId).filter((x): x is string => !!x))];
  const names = await itemNames(db, venue.id, ids, guest.language, venue.defaultLanguage);

  return {
    session: { id: row.s.id, status: row.s.status === "bill_requested" ? "bill_requested" : "open" },
    tableLabel: row.label,
    me: { id: guest.id, alias: guest.alias },
    guests: gs.map((g) => ({ id: g.id, alias: g.alias })),
    items: its.map(({ i, round }) => ({
      id: i.id,
      orderId: i.orderId,
      guestId: i.guestId,
      round,
      name: (i.itemId && names.get(i.itemId)) || i.nameSnapshot,
      qty: i.qty,
      unitCents: i.unitCentsSnapshot,
      note: i.note,
      status: i.status,
      fulfillment: i.fulfillment,
    })),
    totalCents: its.filter(({ i }) => BILLABLE.has(i.status)).reduce((a, { i }) => a + i.unitCentsSnapshot * i.qty, 0),
    calls: calls.map(toCallDTO),
    orderMode: venue.orderMode,
  };
}

function toCallDTO(c: typeof serviceCalls.$inferSelect): CallDTO {
  return { id: c.id, type: c.type, status: c.status, createdAt: c.createdAt.toISOString() };
}

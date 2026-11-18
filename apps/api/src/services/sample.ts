import { randomBytes } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { LANGUAGES, type Role } from "@resan/shared";
import type { Ctx } from "../context";
import { categories, guests, memberships, orderItems, orders, payments, tableAssignments, tableSessions, tables, users, venues } from "../db/schema";
import { createSampleFloor, createSampleMenu } from "../db/seed";
import { audit } from "../lib/audit";
import { conflict } from "../lib/errors";
import { hashSecret } from "../lib/password";
import { getVenue } from "../lib/venue";
import { generateBill, registerPayment } from "./bills";
import { createCall } from "./calls";
import { createOrder, updateItemStatus } from "./orders";
import { openSession } from "./sessions";

export interface SampleResult {
  tables: number;
  items: number;
  staff: { name: string; role: string; pin: string }[];
  activity: boolean;
}

/**
 * Rellena un local vacío con datos de ejemplo para enseñarlo: carta en seis idiomas, mesas con
 * QR, un camarero y un cocinero con PIN y, si se pide, servicio en marcha (mesas abiertas,
 * comandas en cocina, platos listos y una llamada). Solo funciona si el local no tiene carta ni mesas.
 */
export async function loadSampleData(
  ctx: Ctx,
  args: { venueId: string; userId: string; activity: boolean },
): Promise<SampleResult> {
  const { db } = ctx;
  const { venueId } = args;
  const [[cats], [tbls]] = await Promise.all([
    db.select({ n: count() }).from(categories).where(eq(categories.venueId, venueId)),
    db.select({ n: count() }).from(tables).where(eq(tables.venueId, venueId)),
  ]);
  if ((cats?.n ?? 0) > 0 || (tbls?.n ?? 0) > 0) throw conflict("venue_not_empty");

  const venue = await getVenue(ctx, venueId);
  const tableRows = await createSampleFloor(db, venueId);
  const { itemIds } = await createSampleMenu(db, venueId);
  // La carta de ejemplo está traducida a los seis idiomas
  await db.update(venues).set({ languages: [...LANGUAGES] }).where(eq(venues.id, venueId));

  // Personal de ejemplo solo si el equipo está vacío (así no choca con PIN ya asignados)
  const staff: SampleResult["staff"] = [];
  const ids: Record<"laura" | "pablo" | "marcos", string> = { laura: args.userId, pablo: args.userId, marcos: args.userId };
  const [team] = await db.select({ n: count() }).from(memberships).where(eq(memberships.venueId, venueId));
  if ((team?.n ?? 0) <= 1) {
    const suffix = randomBytes(4).toString("hex");
    for (const s of [
      { key: "laura", name: "Laura", role: "waiter", pin: "1111" },
      { key: "marcos", name: "Marcos", role: "kitchen", pin: "2222" },
      { key: "pablo", name: "Pablo", role: "waiter", pin: "3333" },
    ] as const) {
      const [u] = await db
        .insert(users)
        .values({
          email: `${s.key}-${suffix}@ejemplo.resan.app`,
          name: s.name,
          // Entran con PIN; la contraseña es aleatoria y nadie la conoce
          passwordHash: await hashSecret(randomBytes(24).toString("base64url")),
        })
        .returning();
      await db.insert(memberships).values({ userId: u!.id, venueId, role: s.role, pinHash: await hashSecret(s.pin) });
      ids[s.key] = u!.id;
      staff.push({ name: s.name, role: s.role, pin: s.pin });
    }
  }
  const roleOf = (id: string) => (id === args.userId ? "owner" : id === ids.marcos ? "kitchen" : "waiter") as Role;

  if (args.activity) {
    const byLabel = new Map(tableRows.map((t) => [t.label, t]));
    const now = Date.now();
    const ago = (min: number) => new Date(now - min * 60_000);
    const move = async (userId: string, itemIds: string[], to: "preparing" | "ready" | "served") => {
      if (itemIds.length) await updateItemStatus(ctx, { venueId, userId, role: roleOf(userId), ids: itemIds, to });
    };
    const lines = (spec: [string, number, string?][]) => spec.map(([key, qty, note]) => ({ itemId: itemIds[key]!, qty, note }));

    /** Mesa ya atendida y cobrada hoy, con sus tiempos reales (para el panel del encargado). */
    const history = async (label: string, waiter: string, minutesAgo: number, spec: [string, number][], prepMin: number, serveMin: number, tipCents: number) => {
      const { session } = await openSession(ctx, venueId, byLabel.get(label)!.id, waiter);
      const r = await createOrder(ctx, { venue, sessionId: session.id, source: "waiter", createdBy: waiter, items: lines(spec) });
      const its = await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
      const kitchen = its.filter((i) => i.fulfillment === "kitchen").map((i) => i.id);
      const drinks = its.filter((i) => i.fulfillment === "serve").map((i) => i.id);
      await move(ids.marcos, kitchen, "preparing");
      await move(ids.marcos, kitchen, "ready");
      await move(waiter, [...kitchen, ...drinks], "served");
      const bill = await generateBill(ctx, { venueId, sessionId: session.id, userId: waiter, discountCents: 0 });
      await registerPayment(ctx, { venueId, billId: bill.id, userId: waiter, method: tipCents % 2 ? "cash" : "card", amountCents: bill.totalCents, tipCents });
      // Se llevan las marcas de tiempo al momento real en que habría pasado
      const t0 = ago(minutesAgo);
      const at = (min: number) => new Date(t0.getTime() + min * 60_000);
      await db.update(tableSessions).set({ openedAt: at(-2), assignedAt: at(-2), closedAt: at(50) }).where(eq(tableSessions.id, session.id));
      await db.update(tableAssignments).set({ createdAt: at(-2) }).where(eq(tableAssignments.sessionId, session.id));
      await db.update(orders).set({ createdAt: t0 }).where(eq(orders.id, r.orderId));
      if (kitchen.length) {
        await db.update(orderItems).set({ startedAt: at(2), readyAt: at(prepMin), servedAt: at(prepMin + serveMin) }).where(inArray(orderItems.id, kitchen));
      }
      if (drinks.length) await db.update(orderItems).set({ servedAt: at(serveMin + 1) }).where(inArray(orderItems.id, drinks));
      await db.update(payments).set({ createdAt: at(50) }).where(eq(payments.billId, bill.id));
    };

    /** Mesa en marcha ahora mismo. */
    const live = async (label: string, opener: string | null, alias: string | null, minutesAgo: number, spec: [string, number, string?][]) => {
      const { session } = await openSession(ctx, venueId, byLabel.get(label)!.id, opener ?? undefined);
      let guestId: string | null = null;
      if (alias) {
        const [g] = await db.insert(guests).values({ venueId, sessionId: session.id, alias, language: "es" }).returning();
        guestId = g!.id;
      }
      const r = await createOrder(ctx, { venue, sessionId: session.id, guestId, source: alias ? "qr" : "waiter", createdBy: alias ? null : opener, items: lines(spec) });
      const t0 = ago(minutesAgo);
      await db.update(tableSessions).set({ openedAt: ago(minutesAgo + 1) }).where(eq(tableSessions.id, session.id));
      await db.update(tableAssignments).set({ createdAt: ago(minutesAgo + 1) }).where(eq(tableAssignments.sessionId, session.id));
      await db.update(orders).set({ createdAt: t0 }).where(eq(orders.id, r.orderId));
      const its = await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));
      return { session, kitchen: its.filter((i) => i.fulfillment === "kitchen").map((i) => i.id), drinks: its.filter((i) => i.fulfillment === "serve").map((i) => i.id) };
    };

    // Lo que ya pasó hoy: Laura va fina, Pablo tarda en llevar los platos, cocina se retrasa una vez
    await history("2", ids.laura, 190, [["croquetas", 1], ["paella", 2], ["vino", 2]], 13, 2, 300);
    await history("4", ids.pablo, 170, [["hamburguesa", 2], ["cerveza", 2]], 11, 8, 0);
    await history("6", ids.laura, 140, [["merluza", 1], ["ensalada", 1], ["agua", 1]], 12, 3, 150);
    await history("T2", ids.pablo, 120, [["pasta", 2], ["refresco", 2], ["helado", 2]], 19, 3, 0);
    await history("T3", ids.laura, 95, [["bravas", 1], ["hamburguesa", 1], ["cafe", 2]], 10, 1, 200);

    // Ahora mismo
    // Mesa 1: la acaba de abrir un cliente desde el móvil y aún no tiene camarero
    await live("1", null, "Ana", 1, [["croquetas", 1], ["bravas", 1, "poco picantes"], ["cerveza", 2]]);
    // Mesa 3 (Laura): paella al fuego y bebidas servidas
    const m3 = await live("3", ids.laura, null, 17, [["paella", 2], ["agua", 2], ["vino", 1]]);
    await move(ids.marcos, m3.kitchen, "preparing");
    await move(ids.laura, m3.drinks, "served");
    await db.update(orderItems).set({ startedAt: ago(14) }).where(inArray(orderItems.id, m3.kitchen));
    await db.update(orderItems).set({ servedAt: ago(15) }).where(inArray(orderItems.id, m3.drinks));
    // Mesa 5 (Pablo): platos listos hace 7 minutos sin llevar → retraso
    const m5 = await live("5", ids.pablo, "Jordi", 20, [["hamburguesa", 1], ["ensalada", 1], ["refresco", 2]]);
    await move(ids.marcos, m5.kitchen, "preparing");
    await move(ids.marcos, m5.kitchen, "ready");
    await db.update(orderItems).set({ readyAt: ago(7), startedAt: ago(17) }).where(inArray(orderItems.id, m5.kitchen));
    // Terraza T1 (Laura): han comido y piden la cuenta
    const t1 = await live("T1", ids.laura, "Marie", 45, [["pasta", 2], ["tarta", 1], ["cafe", 2]]);
    await move(ids.marcos, t1.kitchen, "preparing");
    await move(ids.marcos, t1.kitchen, "ready");
    await move(ids.laura, [...t1.kitchen, ...t1.drinks], "served");
    await db.update(orderItems).set({ startedAt: ago(43), readyAt: ago(32), servedAt: ago(30) }).where(inArray(orderItems.id, t1.kitchen));
    await db.update(orderItems).set({ servedAt: ago(42) }).where(inArray(orderItems.id, t1.drinks));
    await createCall(ctx, { venueId, sessionId: t1.session.id, type: "bill" });
  }

  await audit(db, { venueId, userId: args.userId, action: "venue.sample_data", entity: "venue", entityId: venueId, data: { activity: args.activity } });
  ctx.bus.publish(venueId, { type: "menu.updated" });
  return { tables: tableRows.length, items: Object.keys(itemIds).length, staff, activity: args.activity };
}

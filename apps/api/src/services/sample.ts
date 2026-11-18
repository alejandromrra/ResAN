import { randomBytes } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { LANGUAGES } from "@resan/shared";
import type { Ctx } from "../context";
import { categories, guests, memberships, tables, users, venues } from "../db/schema";
import { createSampleFloor, createSampleMenu } from "../db/seed";
import { audit } from "../lib/audit";
import { conflict } from "../lib/errors";
import { hashSecret } from "../lib/password";
import { getVenue } from "../lib/venue";
import { createCall } from "./calls";
import { createOrder, updateItemStatus } from "./orders";
import { openSession } from "./sessions";
import { loadStaffSession } from "./views";

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
  const [team] = await db.select({ n: count() }).from(memberships).where(eq(memberships.venueId, venueId));
  if ((team?.n ?? 0) <= 1) {
    const suffix = randomBytes(4).toString("hex");
    for (const s of [
      { name: "Laura (camarera)", role: "waiter", pin: "1111" },
      { name: "Marcos (cocina)", role: "kitchen", pin: "2222" },
    ] as const) {
      const [u] = await db
        .insert(users)
        .values({
          email: `${s.role}-${suffix}@ejemplo.resan.app`,
          name: s.name,
          // Entran con PIN; la contraseña es aleatoria y nadie la conoce
          passwordHash: await hashSecret(randomBytes(24).toString("base64url")),
        })
        .returning();
      await db.insert(memberships).values({ userId: u!.id, venueId, role: s.role, pinHash: await hashSecret(s.pin) });
      staff.push({ name: s.name, role: s.role, pin: s.pin });
    }
  }

  if (args.activity) {
    const byLabel = new Map(tableRows.map((t) => [t.label, t]));
    const order = async (label: string, alias: string | null, lines: [string, number, string?][]) => {
      const { session } = await openSession(ctx, venueId, byLabel.get(label)!.id, args.userId);
      let guestId: string | null = null;
      if (alias) {
        const [g] = await db.insert(guests).values({ venueId, sessionId: session.id, alias, language: "es" }).returning();
        guestId = g!.id;
      }
      const r = await createOrder(ctx, {
        venue,
        sessionId: session.id,
        guestId,
        source: alias ? "qr" : "waiter",
        createdBy: alias ? null : args.userId,
        items: lines.map(([key, qty, note]) => ({ itemId: itemIds[key]!, qty, note })),
      });
      return { session, orderId: r.orderId };
    };
    const advance = async (ids: string[], to: "preparing" | "ready" | "served") => {
      if (ids.length) await updateItemStatus(ctx, { venueId, userId: args.userId, role: "owner", ids, to });
    };
    const itemsOf = async (sessionId: string) =>
      loadStaffSession(db, venueId, sessionId).then((s) => s.orders.flatMap((o) => o.items));

    // Mesa 1: acaban de pedir desde el móvil
    await order("1", "Ana", [["croquetas", 1], ["bravas", 1, "poco picantes"], ["cerveza", 2]]);
    // Mesa 3: plato en preparación y bebidas ya servidas
    const m3 = await order("3", null, [["paella", 2], ["agua", 2], ["vino", 1]]);
    const m3items = await itemsOf(m3.session.id);
    await advance(m3items.filter((i) => i.fulfillment === "kitchen").map((i) => i.id), "preparing");
    await advance(m3items.filter((i) => i.fulfillment === "serve").map((i) => i.id), "served");
    // Mesa 5: platos listos para llevar
    const m5 = await order("5", "Jordi", [["hamburguesa", 1], ["ensalada", 1], ["refresco", 2]]);
    const m5items = await itemsOf(m5.session.id);
    await advance(m5items.filter((i) => i.fulfillment === "kitchen").map((i) => i.id), "preparing");
    await advance(m5items.filter((i) => i.fulfillment === "kitchen").map((i) => i.id), "ready");
    // Terraza T1: han comido y piden la cuenta
    const t1 = await order("T1", "Marie", [["pasta", 2], ["tarta", 1], ["cafe", 2]]);
    const t1items = await itemsOf(t1.session.id);
    await advance(t1items.filter((i) => i.fulfillment === "kitchen").map((i) => i.id), "preparing");
    await advance(t1items.filter((i) => i.fulfillment === "kitchen").map((i) => i.id), "ready");
    await advance(t1items.map((i) => i.id), "served");
    await createCall(ctx, { venueId, sessionId: t1.session.id, type: "bill" });
  }

  await audit(db, { venueId, userId: args.userId, action: "venue.sample_data", entity: "venue", entityId: venueId, data: { activity: args.activity } });
  ctx.bus.publish(venueId, { type: "menu.updated" });
  return { tables: tableRows.length, items: Object.keys(itemIds).length, staff, activity: args.activity };
}

import { randomBytes } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { LANGUAGES } from "@resan/shared";
import type { Ctx } from "../context";
import { categories, memberships, tables, users, venues } from "../db/schema";
import { createSampleFloor, createSampleMenu } from "../db/seed";
import { audit } from "../lib/audit";
import { conflict } from "../lib/errors";
import { hashSecret } from "../lib/password";

export interface SampleResult {
  tables: number;
  items: number;
  staff: { name: string; role: string; pin: string }[];
}

/**
 * Rellena un local vacío con datos de ejemplo para enseñarlo: carta en seis idiomas, mesas con
 * QR y un equipo con PIN (dos camareros y un cocinero). Sin pedidos ni actividad: el servicio
 * empieza cuando el encargado abre el turno. Solo funciona si el local no tiene carta ni mesas.
 */
export async function loadSampleData(
  ctx: Ctx,
  args: { venueId: string; userId: string },
): Promise<SampleResult> {
  const { db } = ctx;
  const { venueId } = args;
  const [[cats], [tbls]] = await Promise.all([
    db.select({ n: count() }).from(categories).where(eq(categories.venueId, venueId)),
    db.select({ n: count() }).from(tables).where(eq(tables.venueId, venueId)),
  ]);
  if ((cats?.n ?? 0) > 0 || (tbls?.n ?? 0) > 0) throw conflict("venue_not_empty");

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
      staff.push({ name: s.name, role: s.role, pin: s.pin });
    }
  }

  await audit(db, { venueId, userId: args.userId, action: "venue.sample_data", entity: "venue", entityId: venueId, data: {} });
  ctx.bus.publish(venueId, { type: "menu.updated" });
  return { tables: tableRows.length, items: Object.keys(itemIds).length, staff };
}

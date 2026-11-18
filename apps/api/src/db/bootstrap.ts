import { eq } from "drizzle-orm";
import { PLAN_FEATURES } from "@resan/shared";
import { hashSecret } from "../lib/password";
import type { Db } from "./index";
import { memberships, tenants, users, venues } from "./schema";

export interface BootstrapInput {
  venueName: string;
  venueSlug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

/**
 * Crea el primer local y su propietario en una instalación nueva. Es idempotente: si el local
 * ya existe no toca nada (la contraseña se cambia desde la app, no reiniciando el servidor).
 */
export async function bootstrapVenue(db: Db, input: BootstrapInput): Promise<"created" | "exists"> {
  const [existing] = await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, input.venueSlug));
  if (existing) return "exists";

  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: input.venueName, plan: "profesional" }).returning();
    const [venue] = await tx
      .insert(venues)
      .values({
        tenantId: tenant!.id,
        name: input.venueName,
        slug: input.venueSlug,
        defaultLanguage: "es",
        languages: ["es", "en"],
        features: PLAN_FEATURES.profesional,
      })
      .returning();

    let [user] = await tx.select().from(users).where(eq(users.email, input.ownerEmail));
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email: input.ownerEmail, name: input.ownerName, passwordHash: await hashSecret(input.ownerPassword) })
        .returning();
    }
    await tx.insert(memberships).values({ userId: user!.id, venueId: venue!.id, role: "owner" });
    return "created" as const;
  });
}

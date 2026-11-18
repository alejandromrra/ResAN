import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FeaturesSchema, LANGUAGES, ORDER_MODES, ROLES, SESSION_OPEN_MODES, resolveFeatures } from "@resan/shared";
import type { Ctx } from "../context";
import { memberships, users, venues } from "../db/schema";
import { audit } from "../lib/audit";
import { conflict, forbidden, notFound, unprocessable } from "../lib/errors";
import { hashSecret, verifySecret } from "../lib/password";
import { getVenue } from "../lib/venue";
import { makeAuth } from "../plugins/auth";
import { buildMe } from "./auth";
import { loadSampleData } from "../services/sample";

const PinSchema = z.string().regex(/^\d{4,8}$/, "El PIN debe tener entre 4 y 8 dígitos");

export function registerStaffAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = makeAuth(app, ctx);

  // ---------- Datos de ejemplo (para enseñar la app) ----------

  app.post("/staff/venue/sample-data", { preHandler: auth.perm("venue.settings") }, async (req, reply) => {
    const s = req.staff!;
    const body = z.object({ activity: z.boolean().default(true) }).parse(req.body ?? {});
    const result = await loadSampleData(ctx, { venueId: s.venueId, userId: s.userId, activity: body.activity });
    reply.status(201);
    return result;
  });

  // ---------- Ajustes del local ----------

  app.patch("/staff/venue", { preHandler: auth.perm("venue.settings") }, async (req) => {
    const s = req.staff!;
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        orderMode: z.enum(ORDER_MODES),
        sessionOpenMode: z.enum(SESSION_OPEN_MODES),
        languages: z.array(z.enum(LANGUAGES)).min(1).max(LANGUAGES.length),
        defaultLanguage: z.enum(LANGUAGES),
        features: FeaturesSchema.partial(),
      })
      .partial()
      .parse(req.body);

    const venue = await getVenue(ctx, s.venueId);
    const languages = body.languages ?? venue.languages;
    const defaultLanguage = body.defaultLanguage ?? venue.defaultLanguage;
    if (!languages.includes(defaultLanguage)) throw unprocessable("default_language_not_enabled");

    const { features, ...rest } = body;
    await ctx.db
      .update(venues)
      .set({
        ...rest,
        languages: [...new Set(languages)],
        defaultLanguage,
        ...(features ? { features: { ...resolveFeatures(venue.features), ...features } } : {}),
      })
      .where(eq(venues.id, s.venueId));
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "venue.settings", entity: "venue", entityId: s.venueId, data: body });
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    return buildMe(ctx, { userId: s.userId, name: s.name, venueId: s.venueId, role: s.role });
  });

  // ---------- Usuarios y roles ----------

  app.get("/staff/users", { preHandler: auth.perm("users.manage") }, async (req) => {
    const rows = await ctx.db
      .select({ m: memberships, u: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.venueId, req.staff!.venueId))
      .orderBy(asc(users.name));
    return rows.map(({ m, u }) => ({
      membershipId: m.id,
      userId: u.id,
      email: u.email,
      name: u.name,
      role: m.role,
      hasPin: !!m.pinHash,
    }));
  });

  app.post("/staff/users", { preHandler: auth.perm("users.manage") }, async (req, reply) => {
    const s = req.staff!;
    const body = z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email()),
        name: z.string().trim().min(1).max(80),
        password: z.string().min(8).max(200),
        role: z.enum(ROLES),
        pin: PinSchema.optional(),
      })
      .parse(req.body);
    if (body.role === "owner" && s.role !== "owner") throw forbidden("only_owner_can_assign_owner");
    if (body.pin) await assertPinFree(ctx, s.venueId, body.pin);

    const [existing] = await ctx.db.select().from(users).where(eq(users.email, body.email));
    // Si la persona ya tiene cuenta, se le da acceso a este local sin tocar su contraseña
    const userId =
      existing?.id ??
      (
        await ctx.db
          .insert(users)
          .values({ email: body.email, name: body.name, passwordHash: await hashSecret(body.password) })
          .returning({ id: users.id })
      )[0]!.id;

    const [dup] = await ctx.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.venueId, s.venueId)));
    if (dup) throw conflict("user_already_in_venue");

    const [m] = await ctx.db
      .insert(memberships)
      .values({ userId, venueId: s.venueId, role: body.role, pinHash: body.pin ? await hashSecret(body.pin) : null })
      .returning();
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "user.add", entity: "membership", entityId: m!.id, data: { role: body.role } });
    reply.status(201);
    return { membershipId: m!.id, userId };
  });

  app.patch<{ Params: { id: string } }>("/staff/users/:id", { preHandler: auth.perm("users.manage") }, async (req) => {
    const s = req.staff!;
    const body = z.object({ role: z.enum(ROLES), pin: PinSchema.nullable() }).partial().parse(req.body);
    const target = await membershipOf(ctx, s.venueId, req.params.id);
    if ((target.role === "owner" || body.role === "owner") && s.role !== "owner") throw forbidden("only_owner_can_touch_owner");
    if (target.role === "owner" && body.role && body.role !== "owner") await assertNotLastOwner(ctx, s.venueId, target.id);

    const patch: Partial<typeof memberships.$inferInsert> = {};
    if (body.role) patch.role = body.role;
    if (body.pin !== undefined) {
      if (body.pin) await assertPinFree(ctx, s.venueId, body.pin, target.id);
      patch.pinHash = body.pin ? await hashSecret(body.pin) : null;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.update(memberships).set(patch).where(eq(memberships.id, target.id));
      await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "user.update", entity: "membership", entityId: target.id, data: { role: body.role, pinChanged: body.pin !== undefined } });
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/staff/users/:id", { preHandler: auth.perm("users.manage") }, async (req) => {
    const s = req.staff!;
    const target = await membershipOf(ctx, s.venueId, req.params.id);
    if (target.userId === s.userId) throw conflict("cannot_remove_yourself");
    if (target.role === "owner") {
      if (s.role !== "owner") throw forbidden("only_owner_can_touch_owner");
      await assertNotLastOwner(ctx, s.venueId, target.id);
    }
    await ctx.db.delete(memberships).where(eq(memberships.id, target.id));
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "user.remove", entity: "membership", entityId: target.id });
    return { ok: true };
  });
}

async function membershipOf(ctx: Ctx, venueId: string, membershipId: string) {
  const [m] = await ctx.db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.venueId, venueId)));
  if (!m) throw notFound("membership_not_found");
  return m;
}

async function assertNotLastOwner(ctx: Ctx, venueId: string, membershipId: string) {
  const others = await ctx.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.venueId, venueId), eq(memberships.role, "owner"), ne(memberships.id, membershipId)));
  if (others.length === 0) throw conflict("last_owner");
}

/** Dos personas con el mismo PIN en un local haría ambiguo el acceso rápido. */
async function assertPinFree(ctx: Ctx, venueId: string, pin: string, exceptMembershipId?: string) {
  const rows = await ctx.db
    .select({ id: memberships.id, pinHash: memberships.pinHash })
    .from(memberships)
    .where(and(eq(memberships.venueId, venueId), isNotNull(memberships.pinHash)));
  for (const r of rows) {
    if (r.id !== exceptMembershipId && r.pinHash && (await verifySecret(pin, r.pinHash))) throw conflict("pin_in_use");
  }
}

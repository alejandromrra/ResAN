import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveFeatures, type LoginResponseDTO, type StaffMeDTO } from "@resan/shared";
import type { Ctx } from "../context";
import { memberships, users, venues } from "../db/schema";
import { unauthorized } from "../lib/errors";
import { burnVerify, verifySecret } from "../lib/password";
import { getVenue, venueDefaultLanguage, venueLanguages } from "../lib/venue";
import { makeAuth, signStaffToken } from "../plugins/auth";

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
  venueSlug: z.string().trim().min(1).max(80).optional(),
});

const PinBody = z.object({
  venueSlug: z.string().trim().min(1).max(80),
  pin: z.string().regex(/^\d{4,8}$/),
});

export async function buildMe(
  ctx: Ctx,
  args: { userId: string; name: string; venueId: string; role: StaffMeDTO["role"] },
): Promise<StaffMeDTO> {
  const venue = await getVenue(ctx, args.venueId);
  return {
    userId: args.userId,
    name: args.name,
    venueId: venue.id,
    venueName: venue.name,
    venueSlug: venue.slug,
    role: args.role,
    features: resolveFeatures(venue.features),
    languages: venueLanguages(venue),
    defaultLanguage: venueDefaultLanguage(venue),
    orderMode: venue.orderMode,
    sessionOpenMode: venue.sessionOpenMode,
  };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = makeAuth(app, ctx);

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req): Promise<LoginResponseDTO> => {
      const body = LoginBody.parse(req.body);
      const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email));
      if (!user || !(await verifySecret(body.password, user.passwordHash))) {
        if (!user) await burnVerify(body.password);
        throw unauthorized("invalid_credentials");
      }

      const rows = await ctx.db
        .select({ m: memberships, slug: venues.slug })
        .from(memberships)
        .innerJoin(venues, eq(venues.id, memberships.venueId))
        .where(eq(memberships.userId, user.id))
        .orderBy(asc(memberships.createdAt));
      const chosen = body.venueSlug ? rows.find((r) => r.slug === body.venueSlug) : rows[0];
      if (!chosen) throw unauthorized("no_access_to_venue");

      const token = signStaffToken(app, { uid: user.id, vid: chosen.m.venueId });
      const me = await buildMe(ctx, { userId: user.id, name: user.name, venueId: chosen.m.venueId, role: chosen.m.role });
      return { token, me };
    },
  );

  // Acceso rápido con PIN para los dispositivos de sala y cocina
  app.post(
    "/auth/pin",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req): Promise<LoginResponseDTO> => {
      const body = PinBody.parse(req.body);
      const [venue] = await ctx.db.select().from(venues).where(eq(venues.slug, body.venueSlug));
      const candidates = venue
        ? await ctx.db
            .select({ m: memberships, name: users.name })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.venueId, venue.id), isNotNull(memberships.pinHash)))
        : [];

      let match: (typeof candidates)[number] | undefined;
      for (const c of candidates) {
        if (c.m.pinHash && (await verifySecret(body.pin, c.m.pinHash))) match = c;
      }
      if (!venue || !match) {
        if (candidates.length === 0) await burnVerify(body.pin);
        throw unauthorized("invalid_pin");
      }

      const token = signStaffToken(app, { uid: match.m.userId, vid: venue.id });
      const me = await buildMe(ctx, { userId: match.m.userId, name: match.name, venueId: venue.id, role: match.m.role });
      return { token, me };
    },
  );

  app.get("/staff/me", { preHandler: auth.staff }, async (req) => {
    const s = req.staff!;
    return buildMe(ctx, { userId: s.userId, name: s.name, venueId: s.venueId, role: s.role });
  });
}

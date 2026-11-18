import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CALL_TYPES,
  isLanguage,
  pickLanguage,
  resolveFeatures,
  type JoinResponseDTO,
  type Language,
  type PublicTableDTO,
} from "@resan/shared";
import type { Ctx } from "../context";
import { guests, tables } from "../db/schema";
import { conflict, forbidden, isUniqueViolation, notFound } from "../lib/errors";
import { assertFeature, getVenue, venueDefaultLanguage, venueLanguages } from "../lib/venue";
import { makeAuth, signGuestToken } from "../plugins/auth";
import { createCall } from "../services/calls";
import { loadPublicMenu, type VenueRow } from "../services/menu";
import { createOrder, MAX_LINES_PER_ORDER, MAX_QTY_PER_LINE } from "../services/orders";
import { findOpenSession, openSession } from "../services/sessions";
import { currentShift, requireOpenShift } from "../services/shifts";
import { loadGuestSession } from "../services/views";

const GUEST_LABEL: Record<Language, string> = {
  es: "Comensal",
  ca: "Comensal",
  en: "Guest",
  fr: "Convive",
  it: "Ospite",
  de: "Gast",
};

const JoinBody = z.object({
  deviceId: z.string().min(8).max(64),
  alias: z.string().trim().min(1).max(30).optional(),
  language: z.string().max(10).optional(),
});

const OrderBody = z.object({
  idempotencyKey: z.string().min(8).max(80),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
        note: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1)
    .max(MAX_LINES_PER_ORDER),
});

const CallBody = z.object({ type: z.enum(CALL_TYPES) });
const MeBody = z.object({
  alias: z.string().trim().min(1).max(30).optional(),
  language: z.string().max(10).optional(),
});

function requestedLanguage(req: FastifyRequest, queryLang?: string): string | undefined {
  if (queryLang) return queryLang;
  const header = req.headers["accept-language"];
  return typeof header === "string" ? header.split(",")[0] : undefined;
}

async function tableByToken(ctx: Ctx, token: string) {
  const [t] = await ctx.db
    .select()
    .from(tables)
    .where(and(eq(tables.qrToken, token), eq(tables.active, true)));
  if (!t) throw notFound("table_not_found");
  return t;
}

export function registerPublicRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = makeAuth(app, ctx);

  // Carta de la mesa que identifica el QR
  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>(
    "/public/q/:token",
    async (req): Promise<PublicTableDTO> => {
      const table = await tableByToken(ctx, req.params.token);
      const venue = await getVenue(ctx, table.venueId);
      const languages = venueLanguages(venue);
      const language = pickLanguage(requestedLanguage(req, req.query.lang), languages, venueDefaultLanguage(venue));

      const [session, categories, shift] = await Promise.all([
        findOpenSession(ctx.db, table.id),
        loadPublicMenu(ctx.db, venue, language),
        currentShift(ctx.db, venue.id),
      ]);
      return {
        language,
        venue: {
          id: venue.id,
          name: venue.name,
          languages,
          defaultLanguage: venueDefaultLanguage(venue),
          orderMode: venue.orderMode,
          sessionOpenMode: venue.sessionOpenMode,
          currency: venue.currency,
          features: resolveFeatures(venue.features),
        },
        table: { id: table.id, label: table.label },
        session: session ? { id: session.id, status: "open" } : null,
        serviceOpen: !!shift,
        menu: { categories },
      };
    },
  );

  // Un comensal entra en la mesa (abre la sesión si el local lo permite)
  app.post<{ Params: { token: string } }>(
    "/public/q/:token/join",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply): Promise<JoinResponseDTO> => {
      const body = JoinBody.parse(req.body);
      const table = await tableByToken(ctx, req.params.token);
      const venue = await getVenue(ctx, table.venueId);
      // En "solo carta" no se pide, pero sí se puede entrar para llamar al camarero o pedir la cuenta
      if (venue.orderMode === "view_only" && !resolveFeatures(venue.features).serviceCalls) {
        throw forbidden("view_only");
      }

      await requireOpenShift(ctx.db, venue.id);
      let session = await findOpenSession(ctx.db, table.id);
      if (!session) {
        if (venue.sessionOpenMode !== "auto") throw conflict("session_not_open");
        session = (await openSession(ctx, venue.id, table.id)).session;
      }

      const language = pickLanguage(body.language, venueLanguages(venue), venueDefaultLanguage(venue));

      const findGuest = async () => {
        const [g] = await ctx.db
          .select()
          .from(guests)
          .where(and(eq(guests.sessionId, session!.id), eq(guests.deviceId, body.deviceId)));
        return g;
      };

      let guest = await findGuest();
      if (!guest) {
        const [{ n } = { n: "0" }] = await ctx.db
          .select({ n: sql<string>`count(*)` })
          .from(guests)
          .where(eq(guests.sessionId, session.id));
        try {
          [guest] = await ctx.db
            .insert(guests)
            .values({
              venueId: venue.id,
              sessionId: session.id,
              alias: body.alias ?? `${GUEST_LABEL[language]} ${Number(n) + 1}`,
              language,
              deviceId: body.deviceId,
            })
            .returning();
          ctx.bus.publish(venue.id, { type: "session.updated", sessionId: session.id });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          guest = await findGuest();
        }
      }
      if (!guest) throw conflict("join_failed");

      reply.status(200);
      return {
        token: signGuestToken(app, { gid: guest.id, sid: session.id, vid: venue.id }),
        guest: { id: guest.id, alias: guest.alias },
        sessionId: session.id,
      };
    },
  );

  // Estado vivo de la mesa para el comensal
  app.get("/public/session", { preHandler: auth.guest }, async (req) => {
    const g = req.guest!;
    const venue = await getVenue(ctx, g.venueId);
    return loadGuestSession(ctx.db, venue, {
      id: g.guestId,
      alias: g.alias,
      language: g.language,
      sessionId: g.sessionId,
    });
  });

  app.patch("/public/me", { preHandler: auth.guest }, async (req) => {
    const g = req.guest!;
    const body = MeBody.parse(req.body);
    const venue = await getVenue(ctx, g.venueId);
    const patch: Partial<typeof guests.$inferInsert> = {};
    if (body.alias) patch.alias = body.alias;
    if (body.language && isLanguage(body.language) && venueLanguages(venue).includes(body.language)) {
      patch.language = body.language;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.update(guests).set(patch).where(eq(guests.id, g.guestId));
      ctx.bus.publish(g.venueId, { type: "session.updated", sessionId: g.sessionId });
    }
    return { ok: true };
  });

  app.post(
    "/public/orders",
    {
      preHandler: auth.guest,
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const g = req.guest!;
      const body = OrderBody.parse(req.body);
      const venue: VenueRow = await getVenue(ctx, g.venueId);
      if (venue.orderMode === "view_only") throw forbidden("view_only");
      await requireOpenShift(ctx.db, venue.id);

      const result = await createOrder(ctx, {
        venue,
        sessionId: g.sessionId,
        guestId: g.guestId,
        source: "qr",
        items: body.items,
        // La clave se acota al comensal para que no choque con la de otro
        idempotencyKey: `${g.guestId}:${body.idempotencyKey}`,
      });
      reply.status(result.duplicate ? 200 : 201);
      return { orderId: result.orderId, round: result.round, status: result.status };
    },
  );

  app.post(
    "/public/calls",
    {
      preHandler: auth.guest,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const g = req.guest!;
      const body = CallBody.parse(req.body);
      assertFeature(await getVenue(ctx, g.venueId), "serviceCalls");
      await requireOpenShift(ctx.db, g.venueId);
      const call = await createCall(ctx, { venueId: g.venueId, sessionId: g.sessionId, type: body.type });
      reply.status(call.duplicate ? 200 : 201);
      return { id: call.id };
    },
  );
}

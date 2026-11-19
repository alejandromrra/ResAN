import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { RESERVATION_STATUSES, WEEKDAYS, resolveReservationSettings } from "@resan/shared";
import type { Ctx } from "../context";
import { apiKeys, venueNotes, venues } from "../db/schema";
import { audit } from "../lib/audit";
import { notFound, unauthorized } from "../lib/errors";
import { isDate } from "../lib/time";
import { getVenue } from "../lib/venue";
import { makeAuth } from "../plugins/auth";
import {
  availability,
  cancelReservation,
  createReservation,
  findReservation,
  guidelines,
  listReservations,
  reservationsByPhone,
  toNoteDTO,
  toReservationDTO,
  updateReservation,
} from "../services/reservations";

const DateStr = z.string().refine(isDate, "Fecha en formato AAAA-MM-DD");
const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora en formato HH:MM");

const ReservationBody = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullish(),
  partySize: z.coerce.number().int().min(1).max(200),
  date: DateStr,
  time: TimeStr,
  notes: z.string().trim().max(1000).optional(),
  durationMinutes: z.number().int().min(15).max(600).optional(),
  tableId: z.uuid().nullish(),
});
const ReservationPatch = ReservationBody.partial().extend({ status: z.enum(RESERVATION_STATUSES).optional() });

const SettingsBody = z
  .object({
    enabled: z.boolean(),
    slotMinutes: z.number().int().min(5).max(240),
    durationMinutes: z.number().int().min(15).max(600),
    maxCovers: z.number().int().min(1).max(5000),
    maxPartySize: z.number().int().min(1).max(500),
    minNoticeMinutes: z.number().int().min(0).max(10080),
    hours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.string().max(200)])) as Record<(typeof WEEKDAYS)[number], z.ZodString>).partial(),
  })
  .partial();

const NoteBody = z.object({
  date: DateStr.nullable(),
  text: z.string().trim().min(1).max(2000),
  noReservations: z.boolean().optional(),
});

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Reservas, pautas del día y clave de integración, para el personal. */
export function registerStaffReservationRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = makeAuth(app, ctx);
  const view = auth.perm("reservations.view");
  const manage = auth.perm("reservations.manage");
  const settings = auth.perm("service.settings");

  app.get<{ Querystring: { date?: string } }>("/staff/reservations", { preHandler: view }, async (req) => {
    const venue = await getVenue(ctx, req.staff!.venueId);
    const g = await guidelines(ctx, venue, req.query.date);
    return { date: g.date, reservations: await listReservations(ctx, venue, g.date), guidelines: g };
  });

  app.get<{ Querystring: { date?: string; party?: string } }>("/staff/reservations/availability", { preHandler: view }, async (req) => {
    const venue = await getVenue(ctx, req.staff!.venueId);
    const q = z.object({ date: DateStr, party: z.coerce.number().int().min(1).max(200).default(2) }).parse(req.query);
    return availability(ctx, venue, q.date, q.party);
  });

  app.post("/staff/reservations", { preHandler: manage }, async (req, reply) => {
    const s = req.staff!;
    const body = ReservationBody.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    // El personal puede apuntar una reserva aunque el sistema diga que está lleno
    const r = await createReservation(ctx, venue, body, { source: "staff", userId: s.userId, enforce: false });
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "reservation.create", entity: "reservation", entityId: r.id });
    reply.status(201);
    return r;
  });

  app.patch<{ Params: { id: string } }>("/staff/reservations/:id", { preHandler: manage }, async (req) => {
    const s = req.staff!;
    const body = ReservationPatch.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    const r = await updateReservation(ctx, venue, req.params.id, body, { enforce: false });
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "reservation.update", entity: "reservation", entityId: r.id, data: { status: body.status } });
    return r;
  });

  app.delete<{ Params: { id: string } }>("/staff/reservations/:id", { preHandler: manage }, async (req) => {
    const s = req.staff!;
    const venue = await getVenue(ctx, s.venueId);
    const r = await cancelReservation(ctx, venue, req.params.id);
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "reservation.cancel", entity: "reservation", entityId: r.id });
    return r;
  });

  // ---------- Configuración de reservas ----------

  app.get("/staff/reservations/settings", { preHandler: view }, async (req) =>
    resolveReservationSettings((await getVenue(ctx, req.staff!.venueId)).reservationSettings),
  );

  app.patch("/staff/reservations/settings", { preHandler: settings }, async (req) => {
    const s = req.staff!;
    const body = SettingsBody.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    const current = resolveReservationSettings(venue.reservationSettings);
    const next = { ...current, ...body, hours: { ...current.hours, ...(body.hours ?? {}) } };
    await ctx.db.update(venues).set({ reservationSettings: next }).where(eq(venues.id, s.venueId));
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "reservation.settings", entity: "venue", entityId: s.venueId, data: body });
    ctx.bus.publish(s.venueId, { type: "reservation.updated" });
    return next;
  });

  // ---------- Pautas («hoy no hacemos reservas, por orden de llegada») ----------

  app.get("/staff/notes", { preHandler: view }, async (req) => {
    const rows = await ctx.db.select().from(venueNotes).where(eq(venueNotes.venueId, req.staff!.venueId)).orderBy(asc(venueNotes.date), asc(venueNotes.createdAt));
    return rows.map(toNoteDTO);
  });

  app.post("/staff/notes", { preHandler: settings }, async (req, reply) => {
    const s = req.staff!;
    const body = NoteBody.parse(req.body);
    const [row] = await ctx.db
      .insert(venueNotes)
      .values({ venueId: s.venueId, date: body.date, text: body.text, noReservations: body.noReservations ?? false, createdBy: s.userId })
      .returning();
    ctx.bus.publish(s.venueId, { type: "reservation.updated" });
    reply.status(201);
    return toNoteDTO(row!);
  });

  app.patch<{ Params: { id: string } }>("/staff/notes/:id", { preHandler: settings }, async (req) => {
    const s = req.staff!;
    const body = NoteBody.partial().parse(req.body);
    const [row] = await ctx.db
      .update(venueNotes)
      .set(body)
      .where(and(eq(venueNotes.id, req.params.id), eq(venueNotes.venueId, s.venueId)))
      .returning();
    if (!row) throw notFound("note_not_found");
    ctx.bus.publish(s.venueId, { type: "reservation.updated" });
    return toNoteDTO(row);
  });

  app.delete<{ Params: { id: string } }>("/staff/notes/:id", { preHandler: settings }, async (req) => {
    const s = req.staff!;
    const del = await ctx.db.delete(venueNotes).where(and(eq(venueNotes.id, req.params.id), eq(venueNotes.venueId, s.venueId))).returning({ id: venueNotes.id });
    if (!del.length) throw notFound("note_not_found");
    ctx.bus.publish(s.venueId, { type: "reservation.updated" });
    return { ok: true };
  });

  // ---------- Clave para n8n ----------

  app.get("/staff/integrations", { preHandler: settings }, async (req) => {
    const s = req.staff!;
    const [key] = await ctx.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.venueId, s.venueId), isNull(apiKeys.revokedAt)));
    return { key: key ? { prefix: key.prefix, createdAt: key.createdAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null } : null };
  });

  // Genera una clave nueva (la anterior deja de funcionar). Solo se muestra esta vez.
  app.post("/staff/integrations/key", { preHandler: settings }, async (req, reply) => {
    const s = req.staff!;
    const key = `rsn_${randomBytes(24).toString("base64url")}`;
    await ctx.db.transaction(async (tx) => {
      await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.venueId, s.venueId), isNull(apiKeys.revokedAt)));
      await tx.insert(apiKeys).values({ venueId: s.venueId, hash: hashKey(key), prefix: key.slice(0, 10), createdBy: s.userId });
    });
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "integration.key", entity: "venue", entityId: s.venueId });
    reply.status(201);
    return { key };
  });

  app.delete("/staff/integrations/key", { preHandler: settings }, async (req) => {
    const s = req.staff!;
    await ctx.db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.venueId, s.venueId), isNull(apiKeys.revokedAt)));
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "integration.revoke", entity: "venue", entityId: s.venueId });
    return { ok: true };
  });
}

/**
 * API para n8n (agente de reservas). Se autentica con la clave del local:
 * `Authorization: Bearer rsn_…` o `X-Api-Key: rsn_…`. Ver docs/N8N.md.
 */
export function registerIntegrationRoutes(app: FastifyInstance, ctx: Ctx) {
  const venueFor = async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const key = header?.startsWith("Bearer ") ? header.slice(7) : (req.headers["x-api-key"] as string | undefined);
    if (!key?.startsWith("rsn_")) throw unauthorized("invalid_api_key");
    const [row] = await ctx.db
      .select({ id: apiKeys.id, venueId: apiKeys.venueId })
      .from(apiKeys)
      .where(and(eq(apiKeys.hash, hashKey(key)), isNull(apiKeys.revokedAt)));
    if (!row) throw unauthorized("invalid_api_key");
    void ctx.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => {});
    return getVenue(ctx, row.venueId);
  };
  const base = "/integrations/v1";
  const limit = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };

  // Pautas del día para el prompt del agente
  app.get<{ Querystring: { date?: string } }>(`${base}/guidelines`, limit, async (req) => {
    const venue = await venueFor(req);
    return guidelines(ctx, venue, req.query.date);
  });

  app.get<{ Querystring: { date?: string; party?: string } }>(`${base}/availability`, limit, async (req) => {
    const venue = await venueFor(req);
    const q = z.object({ date: DateStr, party: z.coerce.number().int().min(1).max(200) }).parse(req.query);
    return availability(ctx, venue, q.date, q.party);
  });

  // Buscar reservas: por código o por teléfono
  app.get<{ Querystring: { code?: string; phone?: string } }>(`${base}/reservations`, limit, async (req) => {
    const venue = await venueFor(req);
    if (req.query.code) return [toReservationDTO(await findReservation(ctx, venue.id, req.query.code), venue)];
    if (req.query.phone) return reservationsByPhone(ctx, venue, req.query.phone);
    throw notFound("code_or_phone_required");
  });

  app.post(`${base}/reservations`, limit, async (req, reply) => {
    const venue = await venueFor(req);
    const body = ReservationBody.omit({ tableId: true, durationMinutes: true }).parse(req.body);
    const r = await createReservation(ctx, venue, body, { source: "n8n", enforce: true });
    await audit(ctx.db, { venueId: venue.id, userId: null, action: "reservation.create", entity: "reservation", entityId: r.id, data: { source: "n8n" } });
    reply.status(201);
    return r;
  });

  app.patch<{ Params: { id: string } }>(`${base}/reservations/:id`, limit, async (req) => {
    const venue = await venueFor(req);
    const body = ReservationBody.omit({ tableId: true, durationMinutes: true }).partial().parse(req.body);
    const r = await updateReservation(ctx, venue, req.params.id, body, { enforce: true });
    await audit(ctx.db, { venueId: venue.id, userId: null, action: "reservation.update", entity: "reservation", entityId: r.id, data: { source: "n8n" } });
    return r;
  });

  app.delete<{ Params: { id: string } }>(`${base}/reservations/:id`, limit, async (req) => {
    const venue = await venueFor(req);
    const r = await cancelReservation(ctx, venue, req.params.id);
    await audit(ctx.db, { venueId: venue.id, userId: null, action: "reservation.cancel", entity: "reservation", entityId: r.id, data: { source: "n8n" } });
    return r;
  });
}

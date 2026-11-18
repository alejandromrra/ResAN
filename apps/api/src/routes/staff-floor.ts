import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ITEM_STATUSES, PAYMENT_METHODS, can, type FloorTasksDTO } from "@resan/shared";
import type { Ctx } from "../context";
import { guests, tableSessions, tables, zones } from "../db/schema";
import { audit } from "../lib/audit";
import { forbidden, isUniqueViolation, conflict, notFound } from "../lib/errors";
import { newQrToken } from "../lib/tokens";
import { assertFeature, getVenue } from "../lib/venue";
import { makeAuth } from "../plugins/auth";
import { generateBill, loadBillableLines, markBillPrinted, registerPayment, toBillDTO } from "../services/bills";
import { updateCall } from "../services/calls";
import { createOrder, MAX_LINES_PER_ORDER, MAX_QTY_PER_LINE, setOrderApproval, updateItemStatus } from "../services/orders";
import { closeSession, openSession } from "../services/sessions";
import { floorTasks, kitchenTickets, listTables, loadStaffSession } from "../services/views";
import { assignSession, claimSession, reassignSession, tableOffers, waiterLoads } from "../services/assignment";
import { computeDelays } from "../services/delays";
import { venueStats } from "../services/stats";
import { bills } from "../db/schema";

const OrderLine = z.object({
  itemId: z.uuid(),
  qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
  note: z.string().trim().max(200).nullish(),
});

export function registerStaffFloorRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = makeAuth(app, ctx);

  // ---------- Mesas y zonas ----------

  app.get("/staff/tables", { preHandler: auth.perm("tables.view") }, async (req) =>
    listTables(ctx.db, req.staff!.venueId),
  );

  app.get("/staff/zones", { preHandler: auth.perm("tables.view") }, async (req) =>
    ctx.db.select().from(zones).where(eq(zones.venueId, req.staff!.venueId)).orderBy(zones.sort),
  );

  app.post("/staff/zones", { preHandler: auth.perm("tables.manage") }, async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(60), sort: z.number().int().optional() }).parse(req.body);
    const [zone] = await ctx.db
      .insert(zones)
      .values({ venueId: req.staff!.venueId, name: body.name, sort: body.sort ?? 0 })
      .returning();
    reply.status(201);
    return zone;
  });

  app.post("/staff/tables", { preHandler: auth.perm("tables.manage") }, async (req, reply) => {
    const s = req.staff!;
    const body = z
      .object({
        label: z.string().trim().min(1).max(30),
        capacity: z.number().int().min(1).max(100).optional(),
        zoneId: z.uuid().nullish(),
      })
      .parse(req.body);
    if (body.zoneId) await assertZone(ctx, s.venueId, body.zoneId);
    try {
      const [t] = await ctx.db
        .insert(tables)
        .values({
          venueId: s.venueId,
          label: body.label,
          capacity: body.capacity ?? 4,
          zoneId: body.zoneId ?? null,
          qrToken: newQrToken(),
        })
        .returning();
      reply.status(201);
      return { id: t!.id, qrToken: t!.qrToken };
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("table_label_taken");
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>("/staff/tables/:id", { preHandler: auth.perm("tables.manage") }, async (req) => {
    const s = req.staff!;
    const body = z
      .object({
        label: z.string().trim().min(1).max(30),
        capacity: z.number().int().min(1).max(100),
        zoneId: z.uuid().nullable(),
        active: z.boolean(),
      })
      .partial()
      .parse(req.body);
    if (body.zoneId) await assertZone(ctx, s.venueId, body.zoneId);
    try {
      const updated = await ctx.db
        .update(tables)
        .set(body)
        .where(and(eq(tables.id, req.params.id), eq(tables.venueId, s.venueId)))
        .returning({ id: tables.id });
      if (updated.length === 0) throw notFound("table_not_found");
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("table_label_taken");
      throw e;
    }
    ctx.bus.publish(s.venueId, { type: "table.updated", tableId: req.params.id });
    return { ok: true };
  });

  // Invalida el QR impreso de una mesa y emite uno nuevo
  app.post<{ Params: { id: string } }>(
    "/staff/tables/:id/regenerate-qr",
    { preHandler: auth.perm("tables.manage") },
    async (req) => {
      const s = req.staff!;
      const [t] = await ctx.db
        .update(tables)
        .set({ qrToken: newQrToken() })
        .where(and(eq(tables.id, req.params.id), eq(tables.venueId, s.venueId)))
        .returning();
      if (!t) throw notFound("table_not_found");
      await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "table.regenerate_qr", entity: "table", entityId: t.id });
      return { qrToken: t.qrToken };
    },
  );

  // ---------- Sesiones de mesa ----------

  app.post<{ Params: { id: string } }>(
    "/staff/tables/:id/session",
    { preHandler: auth.perm("session.open") },
    async (req, reply) => {
      const s = req.staff!;
      const [t] = await ctx.db
        .select()
        .from(tables)
        .where(and(eq(tables.id, req.params.id), eq(tables.venueId, s.venueId), eq(tables.active, true)));
      if (!t) throw notFound("table_not_found");
      const { session, created } = await openSession(ctx, s.venueId, t.id, s.userId);
      reply.status(created ? 201 : 200);
      return { sessionId: session.id };
    },
  );

  app.get<{ Params: { id: string } }>("/staff/sessions/:id", { preHandler: auth.perm("tables.view") }, async (req) =>
    loadStaffSession(ctx.db, req.staff!.venueId, req.params.id),
  );

  app.post<{ Params: { id: string } }>(
    "/staff/sessions/:id/close",
    { preHandler: auth.staff },
    async (req) => {
      const s = req.staff!;
      const force = can(s.role, "session.close_force");
      if (!force && !can(s.role, "session.open")) throw forbidden("forbidden");
      const body = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
      const [session] = await ctx.db
        .select()
        .from(tableSessions)
        .where(and(eq(tableSessions.id, req.params.id), eq(tableSessions.venueId, s.venueId)));
      if (!session) throw notFound("session_not_found");
      if (session.status === "closed") throw conflict("session_closed");
      // Sin permiso de cierre forzado, el camarero solo puede liberar una mesa sin consumo
      if (!force && (await loadBillableLines(ctx.db, session.id)).length > 0) {
        throw forbidden("session_has_consumption");
      }
      await closeSession(ctx, session, body.reason ? `forced: ${body.reason}` : "forced");
      await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "session.force_close", entity: "session", entityId: session.id, data: { reason: body.reason } });
      return { ok: true };
    },
  );

  // ---------- Pedidos ----------

  // El camarero pide en nombre de un comensal (o de la mesa si no se indica comensal)
  app.post<{ Params: { id: string } }>(
    "/staff/sessions/:id/orders",
    { preHandler: auth.perm("orders.create_for_guest") },
    async (req, reply) => {
      const s = req.staff!;
      const body = z
        .object({
          guestId: z.uuid().nullish(),
          idempotencyKey: z.string().min(8).max(80).optional(),
          items: z.array(OrderLine).min(1).max(MAX_LINES_PER_ORDER),
        })
        .parse(req.body);
      if (body.guestId) {
        const [g] = await ctx.db
          .select({ id: guests.id })
          .from(guests)
          .where(and(eq(guests.id, body.guestId), eq(guests.sessionId, req.params.id), eq(guests.venueId, s.venueId)));
        if (!g) throw notFound("guest_not_found");
      }
      const venue = await getVenue(ctx, s.venueId);
      const result = await createOrder(ctx, {
        venue,
        sessionId: req.params.id,
        guestId: body.guestId ?? null,
        source: "waiter",
        createdBy: s.userId,
        items: body.items,
        idempotencyKey: body.idempotencyKey ? `staff:${s.userId}:${body.idempotencyKey}` : null,
      });
      // Quien toma el pedido de una mesa que nadie lleva, se la queda
      if (s.role === "waiter") {
        await assignSession(ctx, { venueId: s.venueId, sessionId: req.params.id, userId: s.userId, mode: "claimed", by: s.userId, onlyIfUnassigned: true });
      }
      reply.status(result.duplicate ? 200 : 201);
      return { orderId: result.orderId, round: result.round, status: result.status };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/staff/orders/:id/approve",
    { preHandler: auth.perm("orders.approve") },
    async (req) => {
      await setOrderApproval(ctx, { venueId: req.staff!.venueId, orderId: req.params.id, approve: true, userId: req.staff!.userId });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/staff/orders/:id/reject",
    { preHandler: auth.perm("orders.approve") },
    async (req) => {
      await setOrderApproval(ctx, { venueId: req.staff!.venueId, orderId: req.params.id, approve: false, userId: req.staff!.userId });
      return { ok: true };
    },
  );

  // Cambio de estado de líneas. Cada rol solo puede hacer sus transiciones.
  app.patch("/staff/order-items/status", { preHandler: auth.staff }, async (req) => {
    const s = req.staff!;
    const body = z
      .object({ ids: z.array(z.uuid()).min(1).max(60), status: z.enum(ITEM_STATUSES) })
      .parse(req.body);
    await updateItemStatus(ctx, { venueId: s.venueId, userId: s.userId, role: s.role, ids: body.ids, to: body.status });
    return { ok: true };
  });

  // ---------- Cocina y sala ----------

  app.get("/staff/kitchen", { preHandler: auth.perm("kitchen.view") }, async (req) => {
    assertFeature(await getVenue(ctx, req.staff!.venueId), "kitchenDisplay");
    return kitchenTickets(ctx.db, req.staff!.venueId);
  });

  app.get("/staff/floor/tasks", { preHandler: auth.perm("tables.view") }, async (req): Promise<FloorTasksDTO> => {
    const s = req.staff!;
    assertFeature(await getVenue(ctx, s.venueId), "waiterView");
    const [base, loads, delays] = await Promise.all([
      floorTasks(ctx.db, s.venueId),
      waiterLoads(ctx, s.venueId),
      computeDelays(ctx.db, s.venueId),
    ]);
    const offers = await tableOffers(ctx, s.venueId, s.userId, loads);
    // El camarero ve los retrasos de sus mesas y de las que nadie lleva; el encargado, todos
    const seeAll = can(s.role, "tables.assign");
    return {
      ...base,
      offers,
      delays: delays.filter((d) => d.audience === "floor" && (seeAll || !d.assigneeId || d.assigneeId === s.userId)),
      waiters: loads,
    };
  });

  // Retrasos activos (cocina usa audience=kitchen)
  app.get<{ Querystring: { audience?: string } }>(
    "/staff/delays",
    { preHandler: auth.perm("kitchen.view", "tables.view") },
    async (req) => {
      const all = await computeDelays(ctx.db, req.staff!.venueId);
      const a = req.query.audience;
      return a === "kitchen" || a === "floor" ? all.filter((d) => d.audience === a) : all;
    },
  );

  // ---------- Asignación de mesas ----------

  // Un camarero coge una mesa abierta por un cliente
  app.post<{ Params: { id: string } }>("/staff/sessions/:id/claim", { preHandler: auth.perm("session.open") }, async (req) => {
    const s = req.staff!;
    await claimSession(ctx, { venueId: s.venueId, sessionId: req.params.id, userId: s.userId });
    return { ok: true };
  });

  // El encargado asigna o reasigna una mesa
  app.post<{ Params: { id: string } }>("/staff/sessions/:id/assign", { preHandler: auth.perm("tables.assign") }, async (req) => {
    const s = req.staff!;
    const body = z.object({ userId: z.uuid() }).parse(req.body);
    await reassignSession(ctx, { venueId: s.venueId, sessionId: req.params.id, userId: body.userId, by: s.userId });
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "session.assign", entity: "session", entityId: req.params.id, data: { to: body.userId } });
    return { ok: true };
  });

  // ---------- Estadísticas del equipo ----------

  app.get<{ Querystring: { date?: string } }>("/staff/stats", { preHandler: auth.perm("stats.view") }, async (req) =>
    venueStats(ctx, req.staff!.venueId, req.query.date || undefined),
  );

  app.post<{ Params: { id: string } }>("/staff/calls/:id/ack", { preHandler: auth.perm("calls.handle") }, async (req) => {
    await updateCall(ctx, { venueId: req.staff!.venueId, callId: req.params.id, userId: req.staff!.userId, to: "ack" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/staff/calls/:id/done", { preHandler: auth.perm("calls.handle") }, async (req) => {
    await updateCall(ctx, { venueId: req.staff!.venueId, callId: req.params.id, userId: req.staff!.userId, to: "done" });
    return { ok: true };
  });

  // ---------- Cuenta y cobro ----------

  app.post<{ Params: { id: string } }>(
    "/staff/sessions/:id/bill",
    { preHandler: auth.perm("bill.manage") },
    async (req, reply) => {
      const s = req.staff!;
      const body = z.object({ discountCents: z.number().int().min(0).optional() }).parse(req.body ?? {});
      const discountCents = body.discountCents ?? 0;
      if (discountCents > 0 && !can(s.role, "orders.void")) throw forbidden("discount_requires_manager");
      const bill = await generateBill(ctx, { venueId: s.venueId, sessionId: req.params.id, userId: s.userId, discountCents });
      reply.status(201);
      return bill;
    },
  );

  app.get<{ Params: { id: string } }>("/staff/bills/:id", { preHandler: auth.perm("bill.manage") }, async (req) => {
    const [bill] = await ctx.db
      .select()
      .from(bills)
      .where(and(eq(bills.id, req.params.id), eq(bills.venueId, req.staff!.venueId)));
    if (!bill) throw notFound("bill_not_found");
    return toBillDTO(ctx.db, bill);
  });

  app.post<{ Params: { id: string } }>(
    "/staff/bills/:id/printed",
    { preHandler: auth.perm("bill.manage") },
    async (req) => markBillPrinted(ctx, req.staff!.venueId, req.params.id),
  );

  app.post<{ Params: { id: string } }>(
    "/staff/bills/:id/payments",
    { preHandler: auth.perm("bill.manage") },
    async (req) => {
      const s = req.staff!;
      const body = z
        .object({
          method: z.enum(PAYMENT_METHODS),
          amountCents: z.number().int().min(1),
          tipCents: z.number().int().min(0).max(1_000_000).optional(),
        })
        .parse(req.body);
      return registerPayment(ctx, {
        venueId: s.venueId,
        billId: req.params.id,
        userId: s.userId,
        method: body.method,
        amountCents: body.amountCents,
        tipCents: body.tipCents ?? 0,
      });
    },
  );
}

async function assertZone(ctx: Ctx, venueId: string, zoneId: string) {
  const [z] = await ctx.db
    .select({ id: zones.id })
    .from(zones)
    .where(and(eq(zones.id, zoneId), eq(zones.venueId, venueId)));
  if (!z) throw notFound("zone_not_found");
}

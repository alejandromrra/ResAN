import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ALLERGENS, FULFILLMENTS, LANGUAGES, TAGS } from "@resan/shared";
import type { Ctx } from "../context";
import { categories, items, translations } from "../db/schema";
import { audit } from "../lib/audit";
import { notFound, unprocessable } from "../lib/errors";
import { getVenue, venueDefaultLanguage, venueLanguages } from "../lib/venue";
import { makeAuth } from "../plugins/auth";
import { loadAdminMenu, upsertTranslations, type VenueRow } from "../services/menu";

const Lang = z.enum(LANGUAGES);
const ItemTr = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional() });
const CatTr = z.object({ name: z.string().trim().min(1).max(80) });

const ItemFields = {
  categoryId: z.uuid(),
  priceCents: z.number().int().min(0).max(1_000_000),
  vatRateBp: z.number().int().min(0).max(3000),
  imageUrl: z
    .string()
    .max(500)
    .regex(/^(https?:\/\/|\/)/, "La imagen debe ser una URL http(s) o una ruta relativa")
    .nullable(),
  fulfillment: z.enum(FULFILLMENTS),
  allergens: z.array(z.enum(ALLERGENS)).max(14),
  tags: z.array(z.enum(TAGS)).max(6),
  available: z.boolean(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(100000),
  translations: z.partialRecord(Lang, ItemTr),
};

const CreateItemBody = z.object({
  ...ItemFields,
  vatRateBp: ItemFields.vatRateBp.optional(),
  imageUrl: ItemFields.imageUrl.optional(),
  fulfillment: ItemFields.fulfillment.optional(),
  allergens: ItemFields.allergens.optional(),
  tags: ItemFields.tags.optional(),
  available: ItemFields.available.optional(),
  sort: ItemFields.sort.optional(),
}).omit({ active: true });

const PatchItemBody = z.object(ItemFields).partial();

const CreateCategoryBody = z.object({
  translations: z.partialRecord(Lang, CatTr),
  sort: z.number().int().min(0).max(100000).optional(),
});
const PatchCategoryBody = z.object({
  translations: z.partialRecord(Lang, CatTr).optional(),
  sort: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});

function checkLanguages(venue: VenueRow, translationsInput: Record<string, unknown> | undefined, requireDefault: boolean) {
  const enabled = venueLanguages(venue);
  const keys = Object.keys(translationsInput ?? {});
  const bad = keys.find((k) => !(enabled as string[]).includes(k));
  if (bad) throw unprocessable("language_not_enabled", { lang: bad });
  if (requireDefault && !keys.includes(venueDefaultLanguage(venue))) {
    throw unprocessable("default_language_required", { lang: venueDefaultLanguage(venue) });
  }
}

export function registerStaffMenuRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = makeAuth(app, ctx);
  const menuEdit = auth.perm("menu.edit");

  // La carta completa también la necesita el camarero para pedir por el cliente
  app.get("/staff/menu", { preHandler: auth.perm("menu.edit", "orders.create_for_guest") }, async (req) =>
    loadAdminMenu(ctx.db, req.staff!.venueId),
  );

  app.post("/staff/categories", { preHandler: menuEdit }, async (req, reply) => {
    const s = req.staff!;
    const body = CreateCategoryBody.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    checkLanguages(venue, body.translations, true);

    const [{ max } = { max: -1 }] = await ctx.db
      .select({ max: sql<number>`coalesce(max(${categories.sort}), -1)` })
      .from(categories)
      .where(eq(categories.venueId, s.venueId));
    const [cat] = await ctx.db
      .insert(categories)
      .values({ venueId: s.venueId, sort: body.sort ?? Number(max) + 1 })
      .returning();
    await upsertTranslations(ctx.db, s.venueId, "category", cat!.id, body.translations);
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    reply.status(201);
    return { id: cat!.id };
  });

  app.patch<{ Params: { id: string } }>("/staff/categories/:id", { preHandler: menuEdit }, async (req) => {
    const s = req.staff!;
    const body = PatchCategoryBody.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    checkLanguages(venue, body.translations, false);

    const patch: Partial<typeof categories.$inferInsert> = {};
    if (body.sort !== undefined) patch.sort = body.sort;
    if (body.active !== undefined) patch.active = body.active;
    const where = and(eq(categories.id, req.params.id), eq(categories.venueId, s.venueId));
    if (Object.keys(patch).length > 0) {
      const updated = await ctx.db.update(categories).set(patch).where(where).returning({ id: categories.id });
      if (updated.length === 0) throw notFound("category_not_found");
    } else {
      const [exists] = await ctx.db.select({ id: categories.id }).from(categories).where(where);
      if (!exists) throw notFound("category_not_found");
    }
    if (body.translations) await upsertTranslations(ctx.db, s.venueId, "category", req.params.id, body.translations);
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    return { ok: true };
  });

  app.post("/staff/items", { preHandler: menuEdit }, async (req, reply) => {
    const s = req.staff!;
    const body = CreateItemBody.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    checkLanguages(venue, body.translations, true);

    const [cat] = await ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, body.categoryId), eq(categories.venueId, s.venueId)));
    if (!cat) throw notFound("category_not_found");

    const [{ max } = { max: -1 }] = await ctx.db
      .select({ max: sql<number>`coalesce(max(${items.sort}), -1)` })
      .from(items)
      .where(eq(items.categoryId, body.categoryId));
    const [item] = await ctx.db
      .insert(items)
      .values({
        venueId: s.venueId,
        categoryId: body.categoryId,
        priceCents: body.priceCents,
        vatRateBp: body.vatRateBp ?? 1000,
        imageUrl: body.imageUrl ?? null,
        fulfillment: body.fulfillment ?? "kitchen",
        allergens: body.allergens ?? [],
        tags: body.tags ?? [],
        available: body.available ?? true,
        sort: body.sort ?? Number(max) + 1,
      })
      .returning();
    await upsertTranslations(ctx.db, s.venueId, "item", item!.id, body.translations);
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "item.create", entity: "item", entityId: item!.id });
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    reply.status(201);
    return { id: item!.id };
  });

  app.patch<{ Params: { id: string } }>("/staff/items/:id", { preHandler: menuEdit }, async (req) => {
    const s = req.staff!;
    const body = PatchItemBody.parse(req.body);
    const venue = await getVenue(ctx, s.venueId);
    checkLanguages(venue, body.translations, false);

    const { translations: trs, ...fields } = body;
    const where = and(eq(items.id, req.params.id), eq(items.venueId, s.venueId));

    if (fields.categoryId) {
      const [cat] = await ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, fields.categoryId), eq(categories.venueId, s.venueId)));
      if (!cat) throw notFound("category_not_found");
    }

    if (Object.keys(fields).length > 0) {
      const updated = await ctx.db.update(items).set(fields).where(where).returning({ id: items.id });
      if (updated.length === 0) throw notFound("item_not_found");
    } else {
      const [exists] = await ctx.db.select({ id: items.id }).from(items).where(where);
      if (!exists) throw notFound("item_not_found");
    }
    if (trs) await upsertTranslations(ctx.db, s.venueId, "item", req.params.id, trs);
    if (fields.priceCents !== undefined) {
      await audit(ctx.db, {
        venueId: s.venueId,
        userId: s.userId,
        action: "item.price",
        entity: "item",
        entityId: req.params.id,
        data: { priceCents: fields.priceCents },
      });
    }
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    return { ok: true };
  });

  // Agotar o reponer un plato: también cocina y sala
  // Borra una categoría con sus platos. Los pedidos antiguos conservan nombre y precio (copias).
  app.delete<{ Params: { id: string } }>("/staff/categories/:id", { preHandler: menuEdit }, async (req) => {
    const s = req.staff!;
    const where = and(eq(categories.id, req.params.id), eq(categories.venueId, s.venueId));
    const [cat] = await ctx.db.select({ id: categories.id }).from(categories).where(where);
    if (!cat) throw notFound("category_not_found");
    await ctx.db.transaction(async (tx) => {
      const its = await tx.select({ id: items.id }).from(items).where(eq(items.categoryId, cat.id));
      const ids = its.map((i) => i.id);
      if (ids.length) {
        await tx.delete(translations).where(and(eq(translations.entity, "item"), inArray(translations.entityId, ids)));
        await tx.delete(items).where(inArray(items.id, ids));
      }
      await tx.delete(translations).where(and(eq(translations.entity, "category"), eq(translations.entityId, cat.id)));
      await tx.delete(categories).where(eq(categories.id, cat.id));
    });
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "category.delete", entity: "category", entityId: cat.id });
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/staff/items/:id", { preHandler: menuEdit }, async (req) => {
    const s = req.staff!;
    const deleted = await ctx.db
      .delete(items)
      .where(and(eq(items.id, req.params.id), eq(items.venueId, s.venueId)))
      .returning({ id: items.id });
    if (!deleted.length) throw notFound("item_not_found");
    await ctx.db.delete(translations).where(and(eq(translations.entity, "item"), eq(translations.entityId, req.params.id)));
    await audit(ctx.db, { venueId: s.venueId, userId: s.userId, action: "item.delete", entity: "item", entityId: req.params.id });
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    return { ok: true };
  });

  // Nuevo orden de categorías o de los platos de una categoría
  app.post("/staff/menu/reorder", { preHandler: menuEdit }, async (req) => {
    const s = req.staff!;
    const body = z.object({ kind: z.enum(["category", "item"]), ids: z.array(z.uuid()).min(1).max(500) }).parse(req.body);
    const table = body.kind === "category" ? categories : items;
    await ctx.db.transaction(async (tx) => {
      for (const [i, id] of body.ids.entries()) {
        await tx.update(table).set({ sort: i }).where(and(eq(table.id, id), eq(table.venueId, s.venueId)));
      }
    });
    ctx.bus.publish(s.venueId, { type: "menu.updated" });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>(
    "/staff/items/:id/availability",
    { preHandler: auth.perm("item.availability") },
    async (req) => {
      const s = req.staff!;
      const body = z.object({ available: z.boolean() }).parse(req.body);
      const updated = await ctx.db
        .update(items)
        .set({ available: body.available })
        .where(and(eq(items.id, req.params.id), eq(items.venueId, s.venueId)))
        .returning({ id: items.id });
      if (updated.length === 0) throw notFound("item_not_found");
      ctx.bus.publish(s.venueId, { type: "menu.updated" });
      return { ok: true };
    },
  );
}

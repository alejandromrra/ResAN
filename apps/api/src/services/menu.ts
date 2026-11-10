import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  LANGUAGES,
  isAllergen,
  isTag,
  type AdminCategoryDTO,
  type AdminItemDTO,
  type Language,
  type MenuCategoryDTO,
} from "@resan/shared";
import type { Db } from "../db";
import { categories, items, translations, venues } from "../db/schema";

export type VenueRow = typeof venues.$inferSelect;

type TrMap = Map<string, { name: string; description: string }>;
const key = (entity: string, id: string, lang: string) => `${entity}:${id}:${lang}`;

function pickTr(map: TrMap, entity: string, id: string, lang: string, def: string) {
  const wanted = map.get(key(entity, id, lang));
  const fallback = map.get(key(entity, id, def));
  return {
    name: wanted?.name || fallback?.name || "",
    description: wanted?.description || fallback?.description || "",
  };
}

async function loadTranslations(db: Db, venueId: string, langs?: string[]): Promise<TrMap> {
  const rows = await db
    .select()
    .from(translations)
    .where(
      langs
        ? and(eq(translations.venueId, venueId), inArray(translations.lang, langs))
        : eq(translations.venueId, venueId),
    );
  const map: TrMap = new Map();
  for (const r of rows) map.set(key(r.entity, r.entityId, r.lang), { name: r.name, description: r.description });
  return map;
}

export async function loadPublicMenu(db: Db, venue: VenueRow, lang: Language): Promise<MenuCategoryDTO[]> {
  const [cats, its, trs] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(and(eq(categories.venueId, venue.id), eq(categories.active, true)))
      .orderBy(asc(categories.sort), asc(categories.id)),
    db
      .select()
      .from(items)
      .where(and(eq(items.venueId, venue.id), eq(items.active, true)))
      .orderBy(asc(items.sort), asc(items.id)),
    loadTranslations(db, venue.id, [...new Set([lang, venue.defaultLanguage])]),
  ]);

  return cats
    .map((c) => ({
      id: c.id,
      name: pickTr(trs, "category", c.id, lang, venue.defaultLanguage).name,
      items: its
        .filter((i) => i.categoryId === c.id)
        .map((i) => {
          const tr = pickTr(trs, "item", i.id, lang, venue.defaultLanguage);
          return {
            id: i.id,
            name: tr.name,
            description: tr.description,
            priceCents: i.priceCents,
            imageUrl: i.imageUrl,
            allergens: i.allergens.filter(isAllergen),
            tags: i.tags.filter(isTag),
            available: i.available,
          };
        }),
    }))
    .filter((c) => c.items.length > 0);
}

export async function loadAdminMenu(db: Db, venueId: string): Promise<AdminCategoryDTO[]> {
  const [cats, its, trs] = await Promise.all([
    db.select().from(categories).where(eq(categories.venueId, venueId)).orderBy(asc(categories.sort), asc(categories.id)),
    db.select().from(items).where(eq(items.venueId, venueId)).orderBy(asc(items.sort), asc(items.id)),
    db.select().from(translations).where(eq(translations.venueId, venueId)),
  ]);

  const trsFor = (entity: "category" | "item", id: string) => {
    const out: Partial<Record<Language, { name: string; description: string }>> = {};
    for (const t of trs) {
      if (t.entity === entity && t.entityId === id && (LANGUAGES as readonly string[]).includes(t.lang)) {
        out[t.lang as Language] = { name: t.name, description: t.description };
      }
    }
    return out;
  };

  return cats.map((c) => ({
    id: c.id,
    sort: c.sort,
    active: c.active,
    translations: Object.fromEntries(
      Object.entries(trsFor("category", c.id)).map(([l, v]) => [l, { name: v!.name }]),
    ),
    items: its
      .filter((i) => i.categoryId === c.id)
      .map(
        (i): AdminItemDTO => ({
          id: i.id,
          categoryId: i.categoryId,
          priceCents: i.priceCents,
          vatRateBp: i.vatRateBp,
          imageUrl: i.imageUrl,
          fulfillment: i.fulfillment,
          allergens: i.allergens.filter(isAllergen),
          tags: i.tags.filter(isTag),
          available: i.available,
          active: i.active,
          sort: i.sort,
          translations: trsFor("item", i.id),
        }),
      ),
  }));
}

/** Nombre de cada plato en `lang` con respaldo en el idioma por defecto. */
export async function itemNames(
  db: Db,
  venueId: string,
  itemIds: string[],
  lang: string,
  defaultLang: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemIds.length === 0) return out;
  const rows = await db
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.venueId, venueId),
        eq(translations.entity, "item"),
        inArray(translations.entityId, itemIds),
        inArray(translations.lang, [...new Set([lang, defaultLang])]),
      ),
    );
  for (const id of itemIds) {
    const hit =
      rows.find((r) => r.entityId === id && r.lang === lang) ??
      rows.find((r) => r.entityId === id && r.lang === defaultLang);
    if (hit) out.set(id, hit.name);
  }
  return out;
}

export async function upsertTranslations(
  db: Db,
  venueId: string,
  entity: "category" | "item",
  entityId: string,
  values: Partial<Record<Language, { name: string; description?: string }>>,
): Promise<void> {
  const rows = Object.entries(values)
    .filter(([, v]) => v && v.name.trim().length > 0)
    .map(([lang, v]) => ({
      venueId,
      entity,
      entityId,
      lang,
      name: v!.name.trim(),
      description: (v!.description ?? "").trim(),
    }));
  if (rows.length === 0) return;
  await db
    .insert(translations)
    .values(rows)
    .onConflictDoUpdate({
      target: [translations.entity, translations.entityId, translations.lang],
      set: { name: sql`excluded.name`, description: sql`excluded.description` },
    });
}

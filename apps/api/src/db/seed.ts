import { eq } from "drizzle-orm";
import { PLAN_FEATURES, type Allergen, type Fulfillment, type Language, type OrderMode, type SessionOpenMode, type Tag } from "@resan/shared";
import { newQrToken } from "../lib/tokens";
import { hashSecret } from "../lib/password";
import { upsertTranslations } from "../services/menu";
import type { Db } from "./index";
import { categories, items, memberships, tables, tenants, users, venues, zones } from "./schema";

type Names = Record<Language, string>;
type Descs = Partial<Record<Language, string>>;

interface DemoItem {
  key: string;
  priceCents: number;
  fulfillment: Fulfillment;
  allergens?: Allergen[];
  tags?: Tag[];
  emoji: string;
  names: Names;
  desc?: Descs;
}

interface DemoCategory {
  names: Names;
  items: DemoItem[];
}

export const DEMO_CATEGORIES: DemoCategory[] = [
  {
    names: { es: "Entrantes", ca: "Entrants", en: "Starters", fr: "Entrées", it: "Antipasti", de: "Vorspeisen" },
    items: [
      {
        key: "bravas", priceCents: 650, fulfillment: "kitchen", allergens: ["eggs"], tags: ["vegetarian"], emoji: "🥔",
        names: { es: "Patatas bravas", ca: "Patates braves", en: "Spicy potatoes", fr: "Pommes de terre bravas", it: "Patate bravas", de: "Kartoffeln Bravas" },
        desc: { es: "Patatas fritas con salsa brava y alioli.", ca: "Patates fregides amb salsa brava i allioli.", en: "Fried potatoes with spicy sauce and aioli." },
      },
      {
        key: "croquetas", priceCents: 800, fulfillment: "kitchen", allergens: ["gluten", "milk", "eggs"], tags: ["recommended"], emoji: "🧆",
        names: { es: "Croquetas de jamón", ca: "Croquetes de pernil", en: "Ham croquettes", fr: "Croquettes au jambon", it: "Crocchette di prosciutto", de: "Schinkenkroketten" },
        desc: { es: "Seis croquetas caseras de jamón ibérico.", ca: "Sis croquetes casolanes de pernil ibèric.", en: "Six homemade Iberian ham croquettes." },
      },
      {
        key: "ensalada", priceCents: 750, fulfillment: "kitchen", allergens: ["fish"], emoji: "🥗",
        names: { es: "Ensalada mixta", ca: "Amanida mixta", en: "Mixed salad", fr: "Salade mixte", it: "Insalata mista", de: "Gemischter Salat" },
        desc: { es: "Lechuga, tomate, cebolla, atún y aceitunas.", ca: "Enciam, tomàquet, ceba, tonyina i olives.", en: "Lettuce, tomato, onion, tuna and olives." },
      },
    ],
  },
  {
    names: { es: "Principales", ca: "Plats principals", en: "Mains", fr: "Plats principaux", it: "Secondi", de: "Hauptgerichte" },
    items: [
      {
        key: "hamburguesa", priceCents: 1250, fulfillment: "kitchen", allergens: ["gluten", "milk", "eggs", "mustard", "sesame"], tags: ["recommended"], emoji: "🍔",
        names: { es: "Hamburguesa de la casa", ca: "Hamburguesa de la casa", en: "House burger", fr: "Burger maison", it: "Hamburger della casa", de: "Hausburger" },
        desc: { es: "Ternera, queso cheddar, bacon y salsa de la casa.", ca: "Vedella, formatge cheddar, bacó i salsa de la casa.", en: "Beef, cheddar, bacon and house sauce." },
      },
      {
        key: "paella", priceCents: 1400, fulfillment: "kitchen", allergens: ["crustaceans", "molluscs", "celery"], emoji: "🥘",
        names: { es: "Paella de marisco", ca: "Paella de marisc", en: "Seafood paella", fr: "Paella aux fruits de mer", it: "Paella di mare", de: "Meeresfrüchte-Paella" },
        desc: { es: "Arroz con gambas, mejillones y calamar.", ca: "Arròs amb gambes, musclos i calamar.", en: "Rice with prawns, mussels and squid." },
      },
      {
        key: "merluza", priceCents: 1550, fulfillment: "kitchen", allergens: ["fish"], tags: ["gluten_free"], emoji: "🐟",
        names: { es: "Merluza a la plancha", ca: "Lluç a la planxa", en: "Grilled hake", fr: "Colin grillé", it: "Nasello alla piastra", de: "Gegrillter Seehecht" },
        desc: { es: "Con verduras salteadas y aceite de oliva.", ca: "Amb verdures saltejades i oli d'oliva.", en: "With sautéed vegetables and olive oil." },
      },
      {
        key: "pasta", priceCents: 1100, fulfillment: "kitchen", allergens: ["gluten", "nuts", "milk"], tags: ["vegetarian"], emoji: "🍝",
        names: { es: "Pasta al pesto", ca: "Pasta al pesto", en: "Pesto pasta", fr: "Pâtes au pesto", it: "Pasta al pesto", de: "Pasta mit Pesto" },
        desc: { es: "Pasta fresca con pesto de albahaca y piñones.", ca: "Pasta fresca amb pesto d'alfàbrega i pinyons.", en: "Fresh pasta with basil and pine nut pesto." },
      },
    ],
  },
  {
    names: { es: "Postres", ca: "Postres", en: "Desserts", fr: "Desserts", it: "Dolci", de: "Nachspeisen" },
    items: [
      {
        key: "tarta", priceCents: 550, fulfillment: "serve", allergens: ["milk", "eggs", "gluten"], tags: ["recommended"], emoji: "🍰",
        names: { es: "Tarta de queso", ca: "Pastís de formatge", en: "Cheesecake", fr: "Gâteau au fromage", it: "Cheesecake", de: "Käsekuchen" },
        desc: { es: "Tarta de queso cremosa al horno.", ca: "Pastís de formatge cremós al forn.", en: "Creamy baked cheesecake." },
      },
      {
        key: "helado", priceCents: 400, fulfillment: "serve", allergens: ["milk"], emoji: "🍨",
        names: { es: "Helado artesano", ca: "Gelat artesà", en: "Artisan ice cream", fr: "Glace artisanale", it: "Gelato artigianale", de: "Handwerkliches Eis" },
      },
    ],
  },
  {
    names: { es: "Bebidas", ca: "Begudes", en: "Drinks", fr: "Boissons", it: "Bevande", de: "Getränke" },
    items: [
      {
        key: "agua", priceCents: 200, fulfillment: "serve", emoji: "💧",
        names: { es: "Agua mineral", ca: "Aigua mineral", en: "Mineral water", fr: "Eau minérale", it: "Acqua minerale", de: "Mineralwasser" },
      },
      {
        key: "cerveza", priceCents: 280, fulfillment: "serve", allergens: ["gluten"], emoji: "🍺",
        names: { es: "Caña de cerveza", ca: "Canya de cervesa", en: "Draught beer", fr: "Demi pression", it: "Birra alla spina", de: "Bier vom Fass" },
      },
      {
        key: "vino", priceCents: 350, fulfillment: "serve", allergens: ["sulphites"], emoji: "🍷",
        names: { es: "Copa de vino tinto", ca: "Copa de vi negre", en: "Glass of red wine", fr: "Verre de vin rouge", it: "Calice di vino rosso", de: "Glas Rotwein" },
      },
      {
        key: "cafe", priceCents: 160, fulfillment: "serve", emoji: "☕",
        names: { es: "Café solo", ca: "Cafè sol", en: "Espresso", fr: "Café expresso", it: "Caffè espresso", de: "Espresso" },
      },
      {
        key: "refresco", priceCents: 250, fulfillment: "serve", emoji: "🥤",
        names: { es: "Refresco", ca: "Refresc", en: "Soft drink", fr: "Soda", it: "Bibita", de: "Erfrischungsgetränk" },
      },
    ],
  },
];

export interface SeedOptions {
  slug?: string;
  name?: string;
  orderMode?: OrderMode;
  sessionOpenMode?: SessionOpenMode;
  /** Prefijo del correo de los usuarios de demo (permite crear varios locales de prueba). */
  emailDomain?: string;
}

export interface SeedResult {
  venueId: string;
  slug: string;
  tableIds: Record<string, string>;
  tableTokens: Record<string, string>;
  itemIds: Record<string, string>;
  categoryIds: string[];
  credentials: {
    owner: { email: string; password: string };
    manager: { email: string; password: string };
    waiter: { email: string; password: string; pin: string };
    kitchen: { email: string; password: string; pin: string };
  };
}

const DEMO_PASSWORD = "demo1234";

/**
 * Crea un local de demostración con carta en seis idiomas, mesas y personal.
 * Devuelve null si ya existe. Solo para desarrollo y pruebas.
 */
export async function seedDemo(db: Db, opts: SeedOptions = {}): Promise<SeedResult | null> {
  const slug = opts.slug ?? "demo";
  const [existing] = await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, slug));
  if (existing) return null;

  const domain = opts.emailDomain ?? "demo.resan.app";
  const languages: Language[] = ["es", "ca", "en", "fr", "it", "de"];

  const [tenant] = await db.insert(tenants).values({ name: opts.name ?? "Bar Demo", plan: "profesional" }).returning();
  const [venue] = await db
    .insert(venues)
    .values({
      tenantId: tenant!.id,
      name: opts.name ?? "Bar Demo",
      slug,
      defaultLanguage: "es",
      languages,
      orderMode: opts.orderMode ?? "direct",
      sessionOpenMode: opts.sessionOpenMode ?? "auto",
      features: PLAN_FEATURES.profesional,
    })
    .returning();
  const venueId = venue!.id;

  // Personal
  const passwordHash = await hashSecret(DEMO_PASSWORD);
  const staff = [
    { key: "owner", email: `owner@${domain}`, name: "Propietario Demo", role: "owner", pin: null },
    { key: "manager", email: `encargado@${domain}`, name: "Encargado Demo", role: "manager", pin: null },
    { key: "waiter", email: `camarero@${domain}`, name: "Camarero Demo", role: "waiter", pin: "1111" },
    { key: "kitchen", email: `cocina@${domain}`, name: "Cocina Demo", role: "kitchen", pin: "2222" },
  ] as const;
  for (const s of staff) {
    const [u] = await db.insert(users).values({ email: s.email, name: s.name, passwordHash }).returning();
    await db.insert(memberships).values({
      userId: u!.id,
      venueId,
      role: s.role,
      pinHash: s.pin ? await hashSecret(s.pin) : null,
    });
  }

  const tableRows = await createSampleFloor(db, venueId);
  const { itemIds, categoryIds } = await createSampleMenu(db, venueId);

  return {
    venueId,
    slug,
    tableIds: Object.fromEntries(tableRows.map((t) => [t.label, t.id])),
    tableTokens: Object.fromEntries(tableRows.map((t) => [t.label, t.qrToken])),
    itemIds,
    categoryIds,
    credentials: {
      owner: { email: `owner@${domain}`, password: DEMO_PASSWORD },
      manager: { email: `encargado@${domain}`, password: DEMO_PASSWORD },
      waiter: { email: `camarero@${domain}`, password: DEMO_PASSWORD, pin: "1111" },
      kitchen: { email: `cocina@${domain}`, password: DEMO_PASSWORD, pin: "2222" },
    },
  };
}

/** Zonas Salón (1–6) y Terraza (T1–T3) con su QR. */
export async function createSampleFloor(db: Db, venueId: string) {
  const [salon, terraza] = await db
    .insert(zones)
    .values([
      { venueId, name: "Salón", sort: 0 },
      { venueId, name: "Terraza", sort: 1 },
    ])
    .returning();
  const labels = [
    ...["1", "2", "3", "4", "5", "6"].map((l) => ({ label: l, zoneId: salon!.id })),
    ...["T1", "T2", "T3"].map((l) => ({ label: l, zoneId: terraza!.id })),
  ];
  const tableRows = await db
    .insert(tables)
    .values(labels.map((l) => ({ venueId, label: l.label, zoneId: l.zoneId, qrToken: newQrToken() })))
    .returning();

  return tableRows;
}

/** Minutos de cocina de los platos de ejemplo (el resto usa el tiempo por defecto del local). */
const SAMPLE_PREP: Record<string, number> = { bravas: 8, croquetas: 6, ensalada: 5, hamburguesa: 12, paella: 20, merluza: 15, pasta: 10 };

/** Carta de ejemplo en seis idiomas, con fotos, alérgenos y etiquetas. */
export async function createSampleMenu(db: Db, venueId: string) {
  const itemIds: Record<string, string> = {};
  const categoryIds: string[] = [];
  let catSort = 0;
  for (const cat of DEMO_CATEGORIES) {
    const [c] = await db.insert(categories).values({ venueId, sort: catSort++ }).returning();
    categoryIds.push(c!.id);
    await upsertTranslations(
      db,
      venueId,
      "category",
      c!.id,
      Object.fromEntries(Object.entries(cat.names).map(([l, name]) => [l, { name }])),
    );
    let itemSort = 0;
    for (const it of cat.items) {
      const [row] = await db
        .insert(items)
        .values({
          venueId,
          categoryId: c!.id,
          priceCents: it.priceCents,
          fulfillment: it.fulfillment,
          prepMinutes: SAMPLE_PREP[it.key] ?? null,
          allergens: it.allergens ?? [],
          tags: it.tags ?? [],
          imageUrl: `/demo/${it.key}.svg`,
          sort: itemSort++,
        })
        .returning();
      itemIds[it.key] = row!.id;
      await upsertTranslations(
        db,
        venueId,
        "item",
        row!.id,
        Object.fromEntries(
          Object.entries(it.names).map(([l, name]) => [l, { name, description: it.desc?.[l as Language] ?? "" }]),
        ),
      );
    }
  }

  return { itemIds, categoryIds };
}

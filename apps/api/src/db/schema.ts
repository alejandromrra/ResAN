import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CALL_TYPES,
  FULFILLMENTS,
  ITEM_STATUSES,
  ORDER_MODES,
  PAYMENT_METHODS,
  PLANS,
  ROLES,
  SESSION_OPEN_MODES,
} from "@resan/shared";

export const planEnum = pgEnum("plan", PLANS);
export const roleEnum = pgEnum("role", ROLES);
export const orderModeEnum = pgEnum("order_mode", ORDER_MODES);
export const sessionOpenModeEnum = pgEnum("session_open_mode", SESSION_OPEN_MODES);
export const fulfillmentEnum = pgEnum("fulfillment", FULFILLMENTS);
export const itemStatusEnum = pgEnum("item_status", ITEM_STATUSES);
export const callTypeEnum = pgEnum("call_type", CALL_TYPES);
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);
export const sessionStatusEnum = pgEnum("session_status", ["open", "bill_requested", "closed"]);
export const orderSourceEnum = pgEnum("order_source", ["qr", "waiter"]);
export const orderStatusEnum = pgEnum("order_status", ["pending_approval", "accepted", "cancelled"]);
export const callStatusEnum = pgEnum("call_status", ["open", "ack", "done"]);
export const billStatusEnum = pgEnum("bill_status", ["draft", "printed", "paid"]);
export const translationEntityEnum = pgEnum("translation_entity", ["category", "item"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const venueRef = () => uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" });

// ---------- Cuenta del cliente del SaaS y locales ----------

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  plan: planEnum("plan").notNull().default("profesional"),
  createdAt: createdAt(),
});

export const venues = pgTable("venues", {
  id: id(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  defaultLanguage: text("default_language").notNull().default("es"),
  languages: text("languages").array().notNull().default(sql`ARRAY['es']::text[]`),
  currency: text("currency").notNull().default("EUR"),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  orderMode: orderModeEnum("order_mode").notNull().default("direct"),
  sessionOpenMode: sessionOpenModeEnum("session_open_mode").notNull().default("auto"),
  features: jsonb("features").notNull().default({}),
  createdAt: createdAt(),
});

// ---------- Personal ----------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    venueId: venueRef(),
    role: roleEnum("role").notNull(),
    pinHash: text("pin_hash"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_venue_uq").on(t.userId, t.venueId)],
);

// ---------- Sala ----------

export const zones = pgTable("zones", {
  id: id(),
  venueId: venueRef(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const tables = pgTable(
  "tables",
  {
    id: id(),
    venueId: venueRef(),
    zoneId: uuid("zone_id").references(() => zones.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    capacity: integer("capacity").notNull().default(4),
    qrToken: text("qr_token").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tables_venue_label_uq").on(t.venueId, t.label)],
);

export const tableSessions = pgTable(
  "table_sessions",
  {
    id: id(),
    venueId: venueRef(),
    tableId: uuid("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
    status: sessionStatusEnum("status").notNull().default("open"),
    openedBy: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
  },
  (t) => [
    // Como mucho una sesión abierta por mesa
    uniqueIndex("table_sessions_one_open_uq").on(t.tableId).where(sql`${t.status} <> 'closed'`),
    index("table_sessions_venue_status_idx").on(t.venueId, t.status),
  ],
);

export const guests = pgTable(
  "guests",
  {
    id: id(),
    venueId: venueRef(),
    sessionId: uuid("session_id").notNull().references(() => tableSessions.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    language: text("language").notNull().default("es"),
    deviceId: text("device_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("guests_session_device_uq").on(t.sessionId, t.deviceId)],
);

// ---------- Carta ----------

export const categories = pgTable("categories", {
  id: id(),
  venueId: venueRef(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const items = pgTable(
  "items",
  {
    id: id(),
    venueId: venueRef(),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    /** IVA en puntos básicos (1000 = 10 %). Se guarda para la integración fiscal futura. */
    vatRateBp: integer("vat_rate_bp").notNull().default(1000),
    imageUrl: text("image_url"),
    fulfillment: fulfillmentEnum("fulfillment").notNull().default("kitchen"),
    allergens: text("allergens").array().notNull().default(sql`ARRAY[]::text[]`),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    available: boolean("available").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("items_venue_category_idx").on(t.venueId, t.categoryId)],
);

export const translations = pgTable(
  "translations",
  {
    id: id(),
    venueId: venueRef(),
    entity: translationEntityEnum("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    lang: text("lang").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
  },
  (t) => [uniqueIndex("translations_uq").on(t.entity, t.entityId, t.lang)],
);

// ---------- Pedidos ----------

export const orders = pgTable(
  "orders",
  {
    id: id(),
    venueId: venueRef(),
    sessionId: uuid("session_id").notNull().references(() => tableSessions.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
    source: orderSourceEnum("source").notNull(),
    round: integer("round").notNull(),
    status: orderStatusEnum("status").notNull().default("accepted"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("orders_idem_uq").on(t.venueId, t.idempotencyKey),
    uniqueIndex("orders_session_round_uq").on(t.sessionId, t.round),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    venueId: venueRef(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => tableSessions.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    /** Copia del nombre (idioma por defecto) y del precio en el momento del pedido. */
    nameSnapshot: text("name_snapshot").notNull(),
    unitCentsSnapshot: integer("unit_cents_snapshot").notNull(),
    vatRateBpSnapshot: integer("vat_rate_bp_snapshot").notNull().default(1000),
    qty: integer("qty").notNull(),
    note: text("note"),
    fulfillment: fulfillmentEnum("fulfillment").notNull(),
    status: itemStatusEnum("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("order_items_session_idx").on(t.sessionId),
    index("order_items_venue_status_idx").on(t.venueId, t.status),
  ],
);

export const serviceCalls = pgTable(
  "service_calls",
  {
    id: id(),
    venueId: venueRef(),
    sessionId: uuid("session_id").notNull().references(() => tableSessions.id, { onDelete: "cascade" }),
    type: callTypeEnum("type").notNull(),
    status: callStatusEnum("status").notNull().default("open"),
    ackBy: uuid("ack_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    ackAt: timestamp("ack_at", { withTimezone: true }),
  },
  (t) => [index("service_calls_venue_status_idx").on(t.venueId, t.status)],
);

// ---------- Cuenta y cobro ----------

export const bills = pgTable("bills", {
  id: id(),
  venueId: venueRef(),
  sessionId: uuid("session_id").notNull().references(() => tableSessions.id, { onDelete: "cascade" }),
  status: billStatusEnum("status").notNull().default("draft"),
  subtotalCents: integer("subtotal_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  /** Copia de las líneas en el momento de generar la cuenta. */
  lines: jsonb("lines").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const payments = pgTable("payments", {
  id: id(),
  venueId: venueRef(),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
  method: paymentMethodEnum("method").notNull(),
  amountCents: integer("amount_cents").notNull(),
  tipCents: integer("tip_cents").notNull().default(0),
  registeredBy: uuid("registered_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    venueId: venueRef(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_venue_idx").on(t.venueId, t.createdAt)],
);

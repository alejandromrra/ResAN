import type { Allergen, Language, Tag } from "./i18n";
import type { Features } from "./features";
import type { Role } from "./rbac";
import type {
  CallType,
  Fulfillment,
  ItemStatus,
  OrderMode,
  PaymentMethod,
  SessionOpenMode,
  TableStatus,
} from "./status";
import type { AssignMode, DelayKind } from "./service";

// ---------- Cliente (carta QR) ----------

export interface MenuItemDTO {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  allergens: Allergen[];
  tags: Tag[];
  available: boolean;
}

export interface MenuCategoryDTO {
  id: string;
  name: string;
  items: MenuItemDTO[];
}

export interface PublicTableDTO {
  language: Language;
  venue: {
    id: string;
    name: string;
    languages: Language[];
    defaultLanguage: Language;
    orderMode: OrderMode;
    sessionOpenMode: SessionOpenMode;
    currency: string;
    features: Features;
  };
  table: { id: string; label: string };
  session: { id: string; status: "open" } | null;
  /** Si el local tiene el turno abierto (si no, solo se puede ver la carta). */
  serviceOpen: boolean;
  menu: { categories: MenuCategoryDTO[] };
}

export interface JoinResponseDTO {
  token: string;
  guest: { id: string; alias: string };
  sessionId: string;
}

export interface SessionItemDTO {
  id: string;
  orderId: string;
  guestId: string | null;
  round: number;
  name: string;
  qty: number;
  unitCents: number;
  note: string | null;
  status: ItemStatus;
  fulfillment: Fulfillment;
}

export interface CallDTO {
  id: string;
  type: CallType;
  status: "open" | "ack" | "done";
  createdAt: string;
}

export interface GuestSessionDTO {
  session: { id: string; status: "open" | "bill_requested" };
  tableLabel: string;
  me: { id: string; alias: string };
  guests: { id: string; alias: string }[];
  items: SessionItemDTO[];
  totalCents: number;
  calls: CallDTO[];
  orderMode: OrderMode;
}

// ---------- Personal ----------

export interface StaffMeDTO {
  userId: string;
  name: string;
  venueId: string;
  venueName: string;
  venueSlug: string;
  role: Role;
  features: Features;
  languages: Language[];
  defaultLanguage: Language;
  orderMode: OrderMode;
  sessionOpenMode: SessionOpenMode;
}

export interface LoginResponseDTO {
  token: string;
  me: StaffMeDTO;
}

export interface StaffTableDTO {
  id: string;
  label: string;
  zoneId: string | null;
  zoneName: string | null;
  capacity: number;
  qrToken: string;
  status: TableStatus;
  sessionId: string | null;
  guestCount: number;
  totalCents: number;
  openedAt: string | null;
  /** Camarero a cargo de la mesa (null: nadie la ha cogido aún). */
  assignee: { userId: string; name: string; mode: AssignMode } | null;
  /** Minutos del retraso más grave de la mesa (0 si va bien). */
  delayMinutes: number;
}

export interface DelayDTO {
  kind: DelayKind;
  audience: "floor" | "kitchen";
  sessionId: string;
  tableLabel: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Plato afectado, si el retraso es de un plato concreto. */
  itemId: string | null;
  itemName: string | null;
  qty: number | null;
  minutes: number;
  since: string;
}

/** Mesa abierta por un cliente que aún no tiene camarero. */
export interface TableOfferDTO {
  sessionId: string;
  tableId: string;
  tableLabel: string;
  openedAt: string;
  /** Momento en que se asignará sola si nadie la coge. */
  autoAssignAt: string;
  /** El usuario actual está entre los camareros menos ocupados (a quien se le ofrece). */
  offeredToMe: boolean;
}

export interface WaiterLoadDTO {
  userId: string;
  name: string;
  online: boolean;
  openTables: number;
}

export interface StaffStatsDTO {
  userId: string;
  name: string;
  role: Role;
  online: boolean;
  /** Mesas que lleva ahora mismo. */
  openTables: number;
  /** Retrasos activos ahora mismo en sus mesas o en cocina. */
  activeDelays: number;
  // Sala
  tablesAssigned: number;
  assignedBy: Record<AssignMode, number>;
  avgClaimSeconds: number | null;
  itemsServed: number;
  avgServeSeconds: number | null;
  lateServes: number;
  callsHandled: number;
  avgCallSeconds: number | null;
  lateCalls: number;
  payments: number;
  revenueCents: number;
  tipsCents: number;
  /** Cobrado por forma de pago (para cuadrar la caja). */
  byMethod: Record<PaymentMethod, number>;
  // Cocina
  itemsPrepared: number;
  avgStartSeconds: number | null;
  avgPrepSeconds: number | null;
  latePrepared: number;
  /** Porcentaje de tareas hechas a tiempo (null si no ha hecho ninguna). */
  onTimePct: number | null;
}

export interface ShiftDTO {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
}

export interface ShiftStateDTO {
  /** Turno abierto ahora (null: el local está esperando a que el encargado lo inicie). */
  current: ShiftDTO | null;
  /** Último turno cerrado. */
  last: ShiftDTO | null;
}

/** Caja de un camarero en un turno: lo que ha cobrado, por forma de pago. */
export interface CashDTO {
  shift: ShiftDTO;
  userId: string;
  name: string;
  payments: { tableLabel: string; method: PaymentMethod; amountCents: number; tipCents: number; at: string }[];
  byMethod: Record<PaymentMethod, number>;
  tipsByMethod: Record<PaymentMethod, number>;
  totalCents: number;
  tipsCents: number;
}

export interface StatsDTO {
  shift: ShiftDTO;
  live: boolean;
  timezone: string;
  totals: {
    tablesServed: number;
    revenueCents: number;
    tipsCents: number;
    itemsServed: number;
    avgServeSeconds: number | null;
    avgPrepSeconds: number | null;
    lateEvents: number;
    activeDelays: number;
  };
  staff: StaffStatsDTO[];
}

export interface StaffOrderItemDTO extends SessionItemDTO {
  guestAlias: string | null;
}

export interface StaffOrderDTO {
  id: string;
  round: number;
  source: "qr" | "waiter";
  status: "pending_approval" | "accepted" | "cancelled";
  guestId: string | null;
  guestAlias: string | null;
  createdAt: string;
  items: StaffOrderItemDTO[];
}

export interface BillLineDTO {
  guestId: string | null;
  guestAlias: string | null;
  name: string;
  qty: number;
  unitCents: number;
  totalCents: number;
}

export interface BillDTO {
  id: string;
  status: "draft" | "printed" | "paid";
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  tipCents: number;
  lines: BillLineDTO[];
  byGuest: { guestId: string | null; alias: string | null; totalCents: number }[];
  createdAt: string;
  tableLabel: string;
  venueName: string;
}

export interface StaffSessionDTO {
  session: {
    id: string;
    tableId: string;
    tableLabel: string;
    status: "open" | "bill_requested" | "closed";
    openedAt: string;
    assignee: { userId: string; name: string; mode: AssignMode } | null;
  };
  guests: { id: string; alias: string }[];
  orders: StaffOrderDTO[];
  calls: CallDTO[];
  bill: BillDTO | null;
  totalCents: number;
}

export interface KitchenTicketDTO {
  orderId: string;
  sessionId: string;
  tableLabel: string;
  round: number;
  createdAt: string;
  items: { id: string; name: string; qty: number; note: string | null; status: ItemStatus }[];
}

export interface FloorTasksDTO {
  ready: { itemId: string; sessionId: string; tableLabel: string; name: string; qty: number }[];
  serve: { itemId: string; sessionId: string; tableLabel: string; name: string; qty: number }[];
  calls: (CallDTO & { sessionId: string; tableLabel: string })[];
  approvals: { orderId: string; sessionId: string; tableLabel: string; itemCount: number }[];
  offers: TableOfferDTO[];
  delays: DelayDTO[];
  waiters: WaiterLoadDTO[];
}

export interface AdminItemDTO {
  id: string;
  categoryId: string;
  priceCents: number;
  vatRateBp: number;
  imageUrl: string | null;
  fulfillment: Fulfillment;
  allergens: Allergen[];
  tags: Tag[];
  available: boolean;
  active: boolean;
  sort: number;
  translations: Partial<Record<Language, { name: string; description: string }>>;
}

export interface AdminCategoryDTO {
  id: string;
  sort: number;
  active: boolean;
  translations: Partial<Record<Language, { name: string }>>;
  items: AdminItemDTO[];
}

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  tipCents?: number;
}

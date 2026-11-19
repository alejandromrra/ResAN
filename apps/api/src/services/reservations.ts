import { randomInt } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import {
  WEEKDAYS,
  resolveReservationSettings,
  type AvailabilityDTO,
  type GuidelinesDTO,
  type ReservationDTO,
  type ReservationSettings,
  type ReservationStatus,
  type VenueNoteDTO,
} from "@resan/shared";
import type { Ctx } from "../context";
import type { Db } from "../db";
import { reservations, tables, venueNotes } from "../db/schema";
import { conflict, isUniqueViolation, notFound, unprocessable } from "../lib/errors";
import { fromMinutes, isDate, isTime, localParts, parseHours, zonedTime } from "../lib/time";
import type { VenueRow } from "./menu";

type Row = typeof reservations.$inferSelect;
/** Estados que ocupan sitio. */
const ACTIVE: ReservationStatus[] = ["confirmed", "seated"];

const tzOf = (v: VenueRow) => v.timezone || "Europe/Madrid";
export const settingsOf = (v: VenueRow): ReservationSettings => resolveReservationSettings(v.reservationSettings);

export function toReservationDTO(r: Row, venue: VenueRow, tableLabel: string | null = null): ReservationDTO {
  const local = localParts(r.startsAt, tzOf(venue));
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    phone: r.phone,
    email: r.email,
    partySize: r.partySize,
    date: local.date,
    time: local.time,
    startsAt: r.startsAt.toISOString(),
    endsAt: new Date(r.startsAt.getTime() + r.durationMinutes * 60_000).toISOString(),
    durationMinutes: r.durationMinutes,
    status: r.status,
    notes: r.notes,
    source: r.source,
    tableId: r.tableId,
    tableLabel,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Inicio y fin (instantes) de un día local, con margen para reservas que empiezan la víspera. */
function dayRange(date: string, tz: string) {
  const start = zonedTime(date, "00:00", tz);
  return { start, end: new Date(start.getTime() + 36 * 3600_000) };
}

export async function listReservations(ctx: Ctx, venue: VenueRow, date: string): Promise<ReservationDTO[]> {
  if (!isDate(date)) throw unprocessable("invalid_date");
  const start = zonedTime(date, "00:00", tzOf(venue));
  const end = zonedTime(nextDay(date), "00:00", tzOf(venue));
  const rows = await ctx.db
    .select({ r: reservations, label: tables.label })
    .from(reservations)
    .leftJoin(tables, eq(tables.id, reservations.tableId))
    .where(and(eq(reservations.venueId, venue.id), gte(reservations.startsAt, start), lt(reservations.startsAt, end)))
    .orderBy(asc(reservations.startsAt), asc(reservations.name));
  return rows.map(({ r, label }) => toReservationDTO(r, venue, label));
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);

// ---------- Pautas ----------

export function toNoteDTO(n: typeof venueNotes.$inferSelect): VenueNoteDTO {
  return { id: n.id, date: n.date, text: n.text, noReservations: n.noReservations, createdAt: n.createdAt.toISOString() };
}

/** Pautas que aplican un día: las permanentes y las de esa fecha. */
export async function notesFor(db: Db, venueId: string, date: string): Promise<VenueNoteDTO[]> {
  const rows = await db
    .select()
    .from(venueNotes)
    .where(and(eq(venueNotes.venueId, venueId), or(isNull(venueNotes.date), eq(venueNotes.date, date))))
    .orderBy(asc(venueNotes.createdAt));
  // Primero las del día (mandan sobre las generales)
  return rows.map(toNoteDTO).sort((a, b) => Number(!!b.date) - Number(!!a.date));
}

export async function guidelines(ctx: Ctx, venue: VenueRow, date?: string, now = new Date()): Promise<GuidelinesDTO> {
  const tz = tzOf(venue);
  const today = localParts(now, tz);
  const day = date && isDate(date) ? date : today.date;
  const notes = await notesFor(ctx.db, venue.id, day);
  const s = settingsOf(venue);
  const weekday = WEEKDAYS[localParts(zonedTime(day, "12:00", tz), tz).weekday]!;
  const blocked = notes.some((n) => n.noReservations);
  const open = s.enabled && !blocked && parseHours(s.hours[weekday]).length > 0;
  const lines = [
    `Restaurante: ${venue.name}. Fecha: ${day}.`,
    open ? `Horario de reservas: ${s.hours[weekday]}.` : "Ese día NO se aceptan reservas.",
    ...notes.map((n) => `- ${n.date ? "Hoy" : "Siempre"}: ${n.text}${n.noReservations ? " (sin reservas este día)" : ""}`),
  ];
  return {
    venue: { name: venue.name, timezone: tz, today: today.date, now: today.time },
    date: day,
    reservationsOpen: open,
    text: lines.join("\n"),
    notes,
    hours: s.hours[weekday],
    settings: { slotMinutes: s.slotMinutes, durationMinutes: s.durationMinutes, maxPartySize: s.maxPartySize, minNoticeMinutes: s.minNoticeMinutes },
  };
}

// ---------- Disponibilidad ----------

/** Turnos de reserva de un día, con los comensales que aún caben en cada uno. */
export async function availability(
  ctx: Ctx,
  venue: VenueRow,
  date: string,
  partySize: number,
  opts: { now?: Date; ignoreId?: string } = {},
): Promise<AvailabilityDTO> {
  if (!isDate(date)) throw unprocessable("invalid_date");
  const now = opts.now ?? new Date();
  const tz = tzOf(venue);
  const s = settingsOf(venue);
  const closed = (reason: string): AvailabilityDTO => ({ date, partySize, open: false, reason, slots: [] });

  if (!s.enabled) return closed("El local no acepta reservas.");
  const notes = await notesFor(ctx.db, venue.id, date);
  const block = notes.find((n) => n.noReservations);
  if (block) return closed(block.text);
  const weekday = WEEKDAYS[localParts(zonedTime(date, "12:00", tz), tz).weekday]!;
  const ranges = parseHours(s.hours[weekday]);
  if (!ranges.length) return closed("Ese día no hay horario de reservas.");
  if (partySize > s.maxPartySize) return closed(`Para grupos de más de ${s.maxPartySize} personas hay que llamar al local.`);

  const { start, end } = dayRange(date, tz);
  const booked = await ctx.db
    .select({ id: reservations.id, startsAt: reservations.startsAt, duration: reservations.durationMinutes, party: reservations.partySize })
    .from(reservations)
    .where(and(eq(reservations.venueId, venue.id), inArray(reservations.status, ACTIVE), gte(reservations.startsAt, new Date(start.getTime() - 12 * 3600_000)), lt(reservations.startsAt, end)));

  const slots: AvailabilityDTO["slots"] = [];
  for (const [from, to] of ranges) {
    // Último turno: el que aún deja un turno completo antes del cierre
    for (let m = from; m <= to - s.slotMinutes; m += s.slotMinutes) {
      const time = fromMinutes(m);
      const at = m >= 24 * 60 ? zonedTime(nextDay(date), time, tz) : zonedTime(date, time, tz);
      const until = at.getTime() + s.durationMinutes * 60_000;
      const used = booked
        .filter((b) => b.id !== opts.ignoreId && b.startsAt.getTime() < until && b.startsAt.getTime() + b.duration * 60_000 > at.getTime())
        .reduce((n, b) => n + b.party, 0);
      const remaining = Math.max(0, s.maxCovers - used);
      const soonEnough = at.getTime() >= now.getTime() + s.minNoticeMinutes * 60_000;
      slots.push({ time, available: soonEnough && remaining >= partySize, remainingCovers: soonEnough ? remaining : 0 });
    }
  }
  const any = slots.some((x) => x.available);
  return { date, partySize, open: true, reason: any ? null : "No quedan huecos para ese número de personas.", slots };
}

// ---------- Alta, cambios y cancelación ----------

export interface ReservationInput {
  name: string;
  phone?: string;
  email?: string | null;
  partySize: number;
  date: string;
  time: string;
  notes?: string;
  durationMinutes?: number;
  tableId?: string | null;
}

/** Código de 6 caracteres sin letras confusas (0/O, 1/I). */
function newCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => abc[randomInt(abc.length)]).join("");
}

/** Comprueba que hay hueco (lo usa el agente; el personal puede apuntar aunque esté lleno). */
async function assertAvailable(ctx: Ctx, venue: VenueRow, date: string, time: string, party: number, ignoreId?: string) {
  const av = await availability(ctx, venue, date, party, { ignoreId });
  if (!av.open) throw conflict("reservations_closed", { reason: av.reason });
  const slot = av.slots.find((x) => x.time === time);
  if (!slot) throw conflict("slot_not_offered", { reason: "Esa hora no está en el horario de reservas.", slots: av.slots.filter((x) => x.available).map((x) => x.time) });
  if (!slot.available) throw conflict("slot_full", { reason: "No hay sitio a esa hora.", slots: av.slots.filter((x) => x.available).map((x) => x.time) });
}

async function checkTable(ctx: Ctx, venueId: string, tableId: string | null | undefined) {
  if (!tableId) return;
  const [t] = await ctx.db.select({ id: tables.id }).from(tables).where(and(eq(tables.id, tableId), eq(tables.venueId, venueId)));
  if (!t) throw notFound("table_not_found");
}

export async function createReservation(
  ctx: Ctx,
  venue: VenueRow,
  input: ReservationInput,
  by: { source: "staff" | "n8n"; userId?: string | null; enforce: boolean },
): Promise<ReservationDTO> {
  if (!isDate(input.date) || !isTime(input.time)) throw unprocessable("invalid_date_time");
  if (by.enforce) await assertAvailable(ctx, venue, input.date, input.time, input.partySize);
  await checkTable(ctx, venue.id, input.tableId);
  const s = settingsOf(venue);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await ctx.db
        .insert(reservations)
        .values({
          venueId: venue.id,
          code: newCode(),
          name: input.name,
          phone: input.phone ?? "",
          email: input.email ?? null,
          partySize: input.partySize,
          startsAt: zonedTime(input.date, input.time, tzOf(venue)),
          durationMinutes: input.durationMinutes ?? s.durationMinutes,
          notes: input.notes ?? "",
          source: by.source,
          tableId: input.tableId ?? null,
          createdBy: by.userId ?? null,
        })
        .returning();
      ctx.bus.publish(venue.id, { type: "reservation.updated" });
      return toReservationDTO(row!, venue);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // código repetido: se prueba otro
    }
  }
  throw conflict("code_generation_failed");
}

/** Busca por id o por código (el agente suele tener el código). */
export async function findReservation(ctx: Ctx, venueId: string, idOrCode: string): Promise<Row> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrCode);
  const [r] = await ctx.db
    .select()
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), isUuid ? eq(reservations.id, idOrCode) : eq(reservations.code, idOrCode.toUpperCase())));
  if (!r) throw notFound("reservation_not_found");
  return r;
}

export async function updateReservation(
  ctx: Ctx,
  venue: VenueRow,
  idOrCode: string,
  patch: Partial<ReservationInput> & { status?: ReservationStatus },
  opts: { enforce: boolean },
): Promise<ReservationDTO> {
  const current = await findReservation(ctx, venue.id, idOrCode);
  const local = localParts(current.startsAt, tzOf(venue));
  const date = patch.date ?? local.date;
  const time = patch.time ?? local.time;
  const party = patch.partySize ?? current.partySize;
  if (!isDate(date) || !isTime(time)) throw unprocessable("invalid_date_time");
  const moved = date !== local.date || time !== local.time || party !== current.partySize;
  if (opts.enforce) {
    if (!ACTIVE.includes(current.status)) throw conflict("reservation_not_active");
    if (moved) await assertAvailable(ctx, venue, date, time, party, current.id);
  }
  await checkTable(ctx, venue.id, patch.tableId);
  const [row] = await ctx.db
    .update(reservations)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
      ...(patch.tableId !== undefined ? { tableId: patch.tableId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      partySize: party,
      startsAt: zonedTime(date, time, tzOf(venue)),
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, current.id))
    .returning();
  ctx.bus.publish(venue.id, { type: "reservation.updated" });
  return toReservationDTO(row!, venue);
}

export async function cancelReservation(ctx: Ctx, venue: VenueRow, idOrCode: string): Promise<ReservationDTO> {
  const current = await findReservation(ctx, venue.id, idOrCode);
  const [row] = await ctx.db
    .update(reservations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(reservations.id, current.id))
    .returning();
  ctx.bus.publish(venue.id, { type: "reservation.updated" });
  return toReservationDTO(row!, venue);
}

/** Reservas activas de un teléfono (para que el agente encuentre la del cliente). */
export async function reservationsByPhone(ctx: Ctx, venue: VenueRow, phone: string, now = new Date()): Promise<ReservationDTO[]> {
  const digits = phone.replace(/\D/g, "").slice(-9);
  if (digits.length < 6) throw unprocessable("invalid_phone");
  const rows = await ctx.db
    .select()
    .from(reservations)
    .where(and(eq(reservations.venueId, venue.id), inArray(reservations.status, ACTIVE), gte(reservations.startsAt, new Date(now.getTime() - 6 * 3600_000))))
    .orderBy(asc(reservations.startsAt));
  return rows.filter((r) => r.phone.replace(/\D/g, "").endsWith(digits)).map((r) => toReservationDTO(r, venue));
}


import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { can, type Permission, type Role } from "@resan/shared";
import type { Ctx } from "../context";
import { guests, memberships, tableSessions, users } from "../db/schema";
import { forbidden, gone, unauthorized } from "../lib/errors";

export interface StaffAuth {
  userId: string;
  venueId: string;
  role: Role;
  name: string;
}

export interface GuestAuth {
  guestId: string;
  sessionId: string;
  venueId: string;
  alias: string;
  language: string;
}

declare module "fastify" {
  interface FastifyRequest {
    staff?: StaffAuth;
    guest?: GuestAuth;
  }
}

export interface StaffToken {
  kind: "staff";
  uid: string;
  vid: string;
}

export interface GuestToken {
  kind: "guest";
  gid: string;
  sid: string;
  vid: string;
}

const TOKEN_TTL = "12h";

export function signStaffToken(app: FastifyInstance, payload: Omit<StaffToken, "kind">): string {
  return app.jwt.sign({ kind: "staff", ...payload }, { expiresIn: TOKEN_TTL });
}

export function signGuestToken(app: FastifyInstance, payload: Omit<GuestToken, "kind">): string {
  return app.jwt.sign({ kind: "guest", ...payload }, { expiresIn: TOKEN_TTL });
}

export function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  return header.slice(7);
}

/** Valida un token de personal y comprueba que la pertenencia al local sigue vigente. */
export async function resolveStaff(app: FastifyInstance, ctx: Ctx, token: string): Promise<StaffAuth> {
  let payload: StaffToken;
  try {
    payload = app.jwt.verify<StaffToken>(token);
  } catch {
    throw unauthorized("invalid_token");
  }
  if (payload.kind !== "staff") throw unauthorized("invalid_token");

  const [m] = await ctx.db
    .select({ role: memberships.role, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, payload.uid), eq(memberships.venueId, payload.vid)));
  if (!m) throw unauthorized("membership_revoked");
  return { userId: payload.uid, venueId: payload.vid, role: m.role, name: m.name };
}

/** Valida un token de comensal. Con la mesa cerrada deja de valer. */
export async function resolveGuest(app: FastifyInstance, ctx: Ctx, token: string): Promise<GuestAuth> {
  let payload: GuestToken;
  try {
    payload = app.jwt.verify<GuestToken>(token);
  } catch {
    throw unauthorized("invalid_token");
  }
  if (payload.kind !== "guest") throw unauthorized("invalid_token");

  const [row] = await ctx.db
    .select({ g: guests, status: tableSessions.status })
    .from(guests)
    .innerJoin(tableSessions, eq(tableSessions.id, guests.sessionId))
    .where(and(eq(guests.id, payload.gid), eq(guests.sessionId, payload.sid), eq(guests.venueId, payload.vid)));
  if (!row) throw unauthorized("invalid_token");
  if (row.status === "closed") throw gone("session_closed");
  return {
    guestId: row.g.id,
    sessionId: row.g.sessionId,
    venueId: row.g.venueId,
    alias: row.g.alias,
    language: row.g.language,
  };
}

export function makeAuth(app: FastifyInstance, ctx: Ctx) {
  const staff = async (req: FastifyRequest) => {
    req.staff = await resolveStaff(app, ctx, bearer(req));
  };

  /** Personal autenticado con alguno de los permisos indicados. */
  const perm =
    (...permissions: Permission[]) =>
    async (req: FastifyRequest) => {
      await staff(req);
      const role = req.staff!.role;
      if (!permissions.some((p) => can(role, p))) throw forbidden("missing_permission", { needs: permissions });
    };

  const guest = async (req: FastifyRequest) => {
    req.guest = await resolveGuest(app, ctx, bearer(req));
  };

  return { staff, perm, guest };
}

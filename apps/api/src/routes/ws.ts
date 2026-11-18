import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import { z } from "zod";
import type { ClientMessage, RealtimeEvent, ServerMessage } from "@resan/shared";
import type { Ctx } from "../context";
import { HttpError } from "../lib/errors";
import { resolveGuest, resolveStaff } from "../plugins/auth";

const AUTH_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 25_000;

const AuthMessage = z.object({
  type: z.literal("auth"),
  token: z.string().min(10).max(2000),
  since: z.number().int().min(0).optional(),
}) satisfies z.ZodType<ClientMessage>;

type Scope =
  | { kind: "staff"; venueId: string; userId: string }
  | { kind: "guest"; venueId: string; sessionId: string };

/**
 * WebSocket con autenticación por primer mensaje (el token no viaja en la URL).
 * El personal recibe todos los eventos de su local. El comensal solo los de su mesa.
 */
export function registerWsRoute(app: FastifyInstance, ctx: Ctx) {
  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    let scope: Scope | undefined;
    let unsubscribe: (() => void) | undefined;
    let alive = true;

    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    const authTimer = setTimeout(() => {
      if (!scope) {
        send({ type: "error", code: "auth_timeout" });
        socket.close(4401, "auth_timeout");
      }
    }, AUTH_TIMEOUT_MS);

    const pingTimer = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, PING_INTERVAL_MS);
    socket.on("pong", () => {
      alive = true;
    });

    const deliver = (event: RealtimeEvent) => {
      if (!scope || event.venueId !== scope.venueId) return;
      if (scope.kind === "guest" && event.type !== "menu.updated" && event.sessionId !== scope.sessionId) return;
      send({ type: "event", event });
    };

    socket.on("message", async (raw: RawData) => {
      if (scope) return; // tras autenticar no se aceptan más mensajes
      try {
        const msg = AuthMessage.parse(JSON.parse(raw.toString()));
        // El token de personal y el de comensal son distintos: se prueba uno y luego el otro
        scope = await authenticate(app, ctx, msg.token);
        clearTimeout(authTimer);
        if (scope.kind === "staff") ctx.bus.join(scope.venueId, scope.userId);

        // Suscribirse antes de reenviar para no perder eventos entre medias
        unsubscribe = ctx.bus.subscribe(deliver);
        const seq = ctx.bus.currentSeq(scope.venueId);
        send({ type: "ready", seq });

        if (msg.since !== undefined) {
          const missed = ctx.bus.since(scope.venueId, msg.since);
          if (missed === null) send({ type: "resync", seq });
          else for (const e of missed) deliver(e);
        }
      } catch (e) {
        const code = e instanceof HttpError ? e.code : "bad_message";
        send({ type: "error", code });
        socket.close(4401, code);
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(pingTimer);
      unsubscribe?.();
      if (scope?.kind === "staff") ctx.bus.leave(scope.venueId, scope.userId);
    });
  });
}

async function authenticate(app: FastifyInstance, ctx: Ctx, token: string): Promise<Scope> {
  try {
    const staff = await resolveStaff(app, ctx, token);
    return { kind: "staff", venueId: staff.venueId, userId: staff.userId };
  } catch (e) {
    if (e instanceof HttpError && e.code === "membership_revoked") throw e;
    const guest = await resolveGuest(app, ctx, token);
    return { kind: "guest", venueId: guest.venueId, sessionId: guest.sessionId };
  }
}

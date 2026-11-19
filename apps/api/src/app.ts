import cors from "@fastify/cors";
import httpProxy from "@fastify/http-proxy";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { HttpError } from "./lib/errors";
import { EventBus } from "./realtime/bus";
import { registerAuthRoutes } from "./routes/auth";
import { registerPublicRoutes } from "./routes/public";
import { registerStaffAdminRoutes } from "./routes/staff-admin";
import { registerStaffFloorRoutes } from "./routes/staff-floor";
import { registerStaffMenuRoutes } from "./routes/staff-menu";
import { registerWsRoute } from "./routes/ws";
import { registerIntegrationRoutes, registerStaffReservationRoutes } from "./routes/reservations";

export interface BuildOptions {
  db: Db;
  config: Config;
  bus?: EventBus;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const ctx: Ctx = { db: opts.db, config: opts.config, bus: opts.bus ?? new EventBus() };

  const app = Fastify({
    logger: opts.logger ?? false,
    // Los clientes envían JSON pequeño; evita cuerpos enormes
    bodyLimit: 256 * 1024,
    trustProxy: opts.config.trustProxy,
  });

  const allowed = new Set(opts.config.corsOrigins);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Sin cabecera Origin (curl, mismo origen) o en la lista configurada
      if (!origin || allowed.has(origin)) return cb(null, true);
      // En desarrollo se acepta además cualquier dirección de la red local (probar desde el móvil)
      cb(null, opts.config.nodeEnv !== "production" && isLocalNetworkOrigin(origin));
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept-Language", "X-Api-Key"],
  });
  await app.register(jwt, { secret: opts.config.jwtSecret });
  await app.register(rateLimit, { global: true, max: opts.config.rateLimitMax, timeWindow: "1 minute" });
  await app.register(websocket, { options: { maxPayload: 8 * 1024 } });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: error.code, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "validation_error", details: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: (error as { code?: string }).code ?? "bad_request" });
    }
    // Un id con formato inválido (p. ej. no es un uuid) llega a Postgres como 22P02: es un 404, no un fallo nuestro
    const pgCode = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (pgCode === "22P02") return reply.status(404).send({ error: "not_found" });
    req.log.error(error);
    return reply.status(500).send({ error: "internal_error" });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: "not_found" }));

  // Toda la API cuelga de API_PREFIX ("" en desarrollo, "/api" en Docker)
  await app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      registerAuthRoutes(api, ctx);
      registerPublicRoutes(api, ctx);
      registerStaffMenuRoutes(api, ctx);
      registerStaffFloorRoutes(api, ctx);
      registerStaffAdminRoutes(api, ctx);
      registerStaffReservationRoutes(api, ctx);
      registerIntegrationRoutes(api, ctx);
      registerWsRoute(api, ctx);
    },
    { prefix: opts.config.apiPrefix },
  );

  // Un solo puerto y dominio: lo que no es API se sirve desde la web Next.js
  if (opts.config.webUpstream) {
    await app.register(httpProxy, {
      upstream: opts.config.webUpstream,
      prefix: "/",
      websocket: false,
      // Los recursos de la web (scripts, imágenes) no cuentan para el límite de peticiones
      config: { rateLimit: false },
    });
  }

  return { app, ctx };
}

/** localhost o IP privada (10/8, 172.16/12, 192.168/16) o nombre .local, con cualquier puerto. */
export function isLocalNetworkOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

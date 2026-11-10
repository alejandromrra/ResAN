import cors from "@fastify/cors";
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
  });

  await app.register(cors, {
    origin: opts.config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept-Language"],
  });
  await app.register(jwt, { secret: opts.config.jwtSecret });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
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

  app.get("/health", async () => ({ ok: true }));

  registerAuthRoutes(app, ctx);
  registerPublicRoutes(app, ctx);
  registerStaffMenuRoutes(app, ctx);
  registerStaffFloorRoutes(app, ctx);
  registerStaffAdminRoutes(app, ctx);
  registerWsRoute(app, ctx);

  return { app, ctx };
}

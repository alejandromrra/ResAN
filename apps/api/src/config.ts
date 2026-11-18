import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres").optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  SEED_DEMO: z.enum(["true", "false"]).default("false"),
  /** Prefijo de la API. Vacío en desarrollo; "/api" cuando web y API comparten dominio (Docker). */
  API_PREFIX: z.string().default(""),
  /** Si se indica, el resto de rutas se sirven desde la web Next.js (un solo puerto y dominio). */
  WEB_UPSTREAM: z.string().optional(),
  /** Detrás de un proxy (Traefik en Easypanel) para obtener la IP real del cliente. */
  TRUST_PROXY: z.enum(["true", "false"]).optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(600),
  /** Primer local y propietario: se crean al arrancar si aún no existen. */
  VENUE_NAME: z.string().optional(),
  VENUE_SLUG: z.string().optional(),
  OWNER_NAME: z.string().optional(),
  OWNER_EMAIL: z.string().optional(),
  OWNER_PASSWORD: z.string().optional(),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl?: string;
  pgliteDir?: string;
  jwtSecret: string;
  corsOrigins: string[];
  seedDemo: boolean;
  apiPrefix: string;
  webUpstream?: string;
  trustProxy: boolean;
  rateLimitMax: number;
  bootstrap?: { venueName: string; venueSlug: string; ownerName: string; ownerEmail: string; ownerPassword: string };
}

const DEV_SECRET = "dev-only-secret-change-me-0123456789abcdef";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  if (e.NODE_ENV === "production" && !e.JWT_SECRET) {
    throw new Error("JWT_SECRET es obligatorio en producción");
  }
  if (e.NODE_ENV === "production" && !e.DATABASE_URL && !e.PGLITE_DIR) {
    throw new Error("DATABASE_URL es obligatorio en producción (sin ella los datos se perderían al reiniciar)");
  }
  const apiPrefix = e.API_PREFIX.replace(/\/+$/, "");
  if (apiPrefix && !apiPrefix.startsWith("/")) throw new Error("API_PREFIX debe empezar por / (p. ej. /api)");
  if (e.WEB_UPSTREAM && !apiPrefix) throw new Error("WEB_UPSTREAM necesita API_PREFIX (p. ej. /api)");

  const bootstrapKeys = [e.VENUE_NAME, e.OWNER_EMAIL, e.OWNER_PASSWORD];
  if (bootstrapKeys.some(Boolean) && !bootstrapKeys.every(Boolean)) {
    throw new Error("Para crear el primer local hacen falta VENUE_NAME, OWNER_EMAIL y OWNER_PASSWORD");
  }
  if (e.OWNER_PASSWORD && e.OWNER_PASSWORD.length < 8) throw new Error("OWNER_PASSWORD debe tener al menos 8 caracteres");
  const slugify = (v: string) =>
    v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    jwtSecret: e.JWT_SECRET ?? DEV_SECRET,
    corsOrigins: e.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
    seedDemo: e.SEED_DEMO === "true",
    apiPrefix,
    webUpstream: e.WEB_UPSTREAM,
    trustProxy: e.TRUST_PROXY ? e.TRUST_PROXY === "true" : e.NODE_ENV === "production",
    rateLimitMax: e.RATE_LIMIT_MAX,
    bootstrap:
      e.VENUE_NAME && e.OWNER_EMAIL && e.OWNER_PASSWORD
        ? {
            venueName: e.VENUE_NAME,
            venueSlug: slugify(e.VENUE_SLUG || e.VENUE_NAME),
            ownerName: e.OWNER_NAME || "Propietario",
            ownerEmail: e.OWNER_EMAIL.trim().toLowerCase(),
            ownerPassword: e.OWNER_PASSWORD,
          }
        : undefined,
  };
}

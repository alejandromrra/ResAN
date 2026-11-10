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
}

const DEV_SECRET = "dev-only-secret-change-me-0123456789abcdef";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  if (e.NODE_ENV === "production" && !e.JWT_SECRET) {
    throw new Error("JWT_SECRET es obligatorio en producción");
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    jwtSecret: e.JWT_SECRET ?? DEV_SECRET,
    corsOrigins: e.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
    seedDemo: e.SEED_DEMO === "true",
  };
}

import { buildApp } from "./app";
import { loadConfig, type Config } from "./config";
import { createDb } from "./db";
import { bootstrapVenue } from "./db/bootstrap";
import { startAssignmentJob } from "./services/assignment";
import { seedDemo } from "./db/seed";

const log = (msg: string) => console.log(`[resan] ${msg}`);

/**
 * Un fallo al arrancar se explica en los registros y el proceso espera antes de salir:
 * si saliera al instante, el contenedor se reiniciaría en bucle y paneles como Easypanel
 * no llegarían a mostrar el mensaje.
 */
async function fatal(step: string, err: unknown): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[resan] ERROR al ${step}: ${msg}\n`);
  if (step === "conectar con la base de datos") {
    console.error("[resan] Revisa DATABASE_URL: usa la «Internal Connection URL» del servicio Postgres del mismo proyecto.\n");
  }
  if (process.env.NODE_ENV === "production") await new Promise((r) => setTimeout(r, 60_000));
  process.exit(1);
}

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  const detail = e instanceof Error && "issues" in e ? JSON.stringify((e as { issues: unknown }).issues) : e;
  await fatal("leer la configuración (variables de entorno)", detail instanceof Error ? detail : new Error(String(detail)));
}
config = config!;

log(`modo ${config.nodeEnv} · puerto ${config.port} · API en "${config.apiPrefix || "/"}"${config.webUpstream ? ` · web interna ${config.webUpstream}` : ""}`);
log(config.databaseUrl ? `base de datos: Postgres (${safeHost(config.databaseUrl)})` : "base de datos: PGlite (embebida)");

let handle: Awaited<ReturnType<typeof createDb>>;
try {
  log("conectando con la base de datos y aplicando migraciones…");
  handle = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  log("base de datos lista");
} catch (e) {
  await fatal("conectar con la base de datos", e);
}
const { db, close } = handle!;

try {
  if (config.seedDemo) {
    const seeded = await seedDemo(db);
    if (seeded) log("local demo creado (slug: demo). Ver docs/ARQUITECTURA.md para las credenciales de desarrollo.");
  }
  if (config.bootstrap) {
    const r = await bootstrapVenue(db, config.bootstrap);
    log(r === "created"
      ? `local "${config.bootstrap.venueName}" creado (slug: ${config.bootstrap.venueSlug}). Entra con ${config.bootstrap.ownerEmail}.`
      : `local "${config.bootstrap.venueSlug}" ya existía; no se ha cambiado nada.`);
  }
} catch (e) {
  await fatal("crear los datos iniciales", e);
}

const { app, ctx } = await buildApp({ db, config, logger: config.nodeEnv !== "test" });
let stopJobs = () => {};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "apagando");
  stopJobs();
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
  log(`listo en el puerto ${config.port}`);
  // Asigna sola cada mesa que lleva 5 minutos sin camarero
  stopJobs = startAssignmentJob(ctx, log);
} catch (e) {
  await fatal(`escuchar en el puerto ${config.port}`, e);
}

/** Muestra host y base de datos sin usuario ni contraseña. */
function safeHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "URL no válida";
  }
}

import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { bootstrapVenue } from "./db/bootstrap";
import { seedDemo } from "./db/seed";

const config = loadConfig();
const { db, close } = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });

if (config.seedDemo) {
  const seeded = await seedDemo(db);
  if (seeded) console.log("Local demo creado (slug: demo). Ver docs/ARQUITECTURA.md para las credenciales de desarrollo.");
}

if (config.bootstrap) {
  const r = await bootstrapVenue(db, config.bootstrap);
  if (r === "created") console.log(`Local "${config.bootstrap.venueName}" creado (slug: ${config.bootstrap.venueSlug}). Entra con ${config.bootstrap.ownerEmail}.`);
}

const { app } = await buildApp({ db, config, logger: config.nodeEnv !== "test" });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "apagando");
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: config.host });

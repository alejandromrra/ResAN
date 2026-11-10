import { loadConfig } from "../config";
import { createDb } from "./index";
import { seedDemo } from "./seed";

const config = loadConfig();
const { db, close } = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const created = await seedDemo(db);
console.log(created ? "Local demo creado." : "El local demo ya existía; no se ha cambiado nada.");
await close();

import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { createDb } from "../db";
import { bootstrapVenue } from "../db/bootstrap";
import { makeApi } from "./helpers";

const base = { NODE_ENV: "test", JWT_SECRET: "t".repeat(40) } as const;

describe("despliegue (un solo dominio)", () => {
  it("monta la API bajo API_PREFIX", async () => {
    const handle = await createDb();
    const { app } = await buildApp({ db: handle.db, config: loadConfig({ ...base, API_PREFIX: "/api" }) });
    await app.ready();
    const api = makeApi(app);
    expect((await api.get("/api/health")).status).toBe(200);
    expect((await api.get("/health")).status).toBe(404);
    expect((await api.post("/api/auth/login", {})).status).toBe(400); // la ruta existe (falla la validación, no 404)
    await app.close();
    await handle.close();
  });

  it("valida la configuración de producción", () => {
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "t".repeat(40) })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, WEB_UPSTREAM: "http://127.0.0.1:3100" })).toThrow(/API_PREFIX/);
    expect(() => loadConfig({ ...base, VENUE_NAME: "Bar" })).toThrow(/OWNER_EMAIL/);
    const c = loadConfig({ ...base, VENUE_NAME: "Bar Pepe Ñandú", OWNER_EMAIL: "Yo@Bar.es ", OWNER_PASSWORD: "12345678" });
    expect(c.bootstrap).toMatchObject({ venueSlug: "bar-pepe-nandu", ownerEmail: "yo@bar.es" });
  });

  it("crea el primer local y su propietario una sola vez", async () => {
    const handle = await createDb();
    const config = loadConfig({ ...base, VENUE_NAME: "Bar Pepe", OWNER_EMAIL: "yo@bar.es", OWNER_PASSWORD: "secreto-largo" });
    expect(await bootstrapVenue(handle.db, config.bootstrap!)).toBe("created");
    expect(await bootstrapVenue(handle.db, config.bootstrap!)).toBe("exists");
    const { app } = await buildApp({ db: handle.db, config });
    await app.ready();
    const api = makeApi(app);
    const login = await api.post("/auth/login", { email: "yo@bar.es", password: "secreto-largo" });
    expect(login.status).toBe(200);
    expect(login.body.me).toMatchObject({ role: "owner", venueSlug: "bar-pepe", venueName: "Bar Pepe" });
    await app.close();
    await handle.close();
  });
});

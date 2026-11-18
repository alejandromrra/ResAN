import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { createDb, type DbHandle } from "../db";
import { bootstrapVenue } from "../db/bootstrap";
import { loginPin, loginStaff, makeApi, type Api } from "./helpers";

let handle: DbHandle;
let api: Api;
let close: () => Promise<void>;

beforeAll(async () => {
  handle = await createDb();
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "t".repeat(40) });
  await bootstrapVenue(handle.db, { venueName: "Bar Pepe", venueSlug: "bar-pepe", ownerName: "Pepe", ownerEmail: "pepe@bar.es", ownerPassword: "secreto-largo" });
  const { app } = await buildApp({ db: handle.db, config });
  await app.ready();
  api = makeApi(app);
  close = async () => { await app.close(); await handle.close(); };
});
afterAll(async () => close());

describe("datos de ejemplo", () => {
  it("rellena un local vacío con carta, mesas y equipo, sin actividad, una sola vez", async () => {
    const owner = await loginStaff(api, "pepe@bar.es", "secreto-largo");
    const r = await api.post("/staff/venue/sample-data", {}, owner);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tables: 9, items: 14 });
    expect(r.body.staff.map((s: any) => s.pin)).toEqual(["1111", "2222", "3333"]);

    // Sin pedidos ni mesas abiertas ni turno
    const tables = (await api.get("/staff/tables", owner)).body as any[];
    expect(tables.every((t) => t.status === "free")).toBe(true);
    expect((await api.get("/staff/shift", owner)).body).toEqual({ current: null, last: null });
    const kitchen = await loginPin(api, "bar-pepe", "2222");
    expect((await api.get("/staff/kitchen", kitchen)).body).toEqual([]);

    const again = await api.post("/staff/venue/sample-data", {}, owner);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("venue_not_empty");
    const waiter = await loginPin(api, "bar-pepe", "1111");
    expect((await api.post("/staff/venue/sample-data", {}, waiter)).status).toBe(403);
  });
});

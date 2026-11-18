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
  it("rellena un local vacío con carta, mesas, equipo y servicio en marcha, una sola vez", async () => {
    const owner = await loginStaff(api, "pepe@bar.es", "secreto-largo");
    const r = await api.post("/staff/venue/sample-data", {}, owner);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tables: 9, items: 14, activity: true });
    expect(r.body.staff.map((s: any) => s.pin)).toEqual(["1111", "2222", "3333"]);

    const tables = (await api.get("/staff/tables", owner)).body as any[];
    expect(tables.filter((t) => t.status !== "free").map((t) => [t.label, t.status])).toEqual([
      ["1", "ready_to_serve"], ["3", "waiting_food"], ["5", "ready_to_serve"], ["T1", "bill_requested"],
    ]);
    const kitchen = await loginPin(api, "bar-pepe", "2222");
    const tickets = (await api.get("/staff/kitchen", kitchen)).body as any[];
    expect(tickets.length).toBe(3);
    const waiter = await loginPin(api, "bar-pepe", "1111");
    const tasks = (await api.get("/staff/floor/tasks", waiter)).body;
    expect(tasks.calls).toHaveLength(1);
    // Mesa 1 la abrió un cliente: se ofrece a los camareros
    expect(tasks.offers.map((o: any) => o.tableLabel)).toEqual(["1"]);
    const byLabel = Object.fromEntries(tables.map((t) => [t.label, t]));
    expect(byLabel["1"].assignee).toBeNull();
    expect(byLabel["3"].assignee.name).toBe("Laura");
    expect(byLabel["5"].assignee.name).toBe("Pablo");
    expect(byLabel["5"].delayMinutes).toBeGreaterThanOrEqual(7);

    // El panel del encargado ya tiene historia del día
    const stats = (await api.get("/staff/stats", owner)).body;
    expect(stats.live).toBe(true);
    const laura = stats.staff.find((x: any) => x.name === "Laura");
    const pablo = stats.staff.find((x: any) => x.name === "Pablo");
    const marcos = stats.staff.find((x: any) => x.name === "Marcos");
    expect(laura.payments).toBe(3);
    expect(laura.onTimePct).toBeGreaterThan(pablo.onTimePct);
    expect(pablo.lateServes).toBeGreaterThan(0);
    expect(marcos.itemsPrepared).toBeGreaterThan(0);
    expect(marcos.latePrepared).toBeGreaterThan(0);

    const again = await api.post("/staff/venue/sample-data", {}, owner);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("venue_not_empty");
    expect((await api.post("/staff/venue/sample-data", {}, waiter)).status).toBe(403);
  });
});

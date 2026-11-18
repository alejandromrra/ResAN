import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinTable, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

let env: TestEnv;
let owner: string;
let manager: string;

beforeAll(async () => {
  env = await setupEnv();
  owner = await loginStaff(env.api, env.seed.credentials.owner.email, env.seed.credentials.owner.password);
  manager = await loginStaff(env.api, env.seed.credentials.manager.email, env.seed.credentials.manager.password);
});
afterAll(async () => env.close());

const menu = async () => (await env.api.get("/staff/menu", manager)).body as any[];

describe("gestión: carta", () => {
  it("borra platos y categorías, y reordena; los pedidos antiguos conservan su nombre", async () => {
    const g = await joinTable(env.api, env.seed.tableTokens["1"]!, uid("dev"));
    await env.api.post("/public/orders", { idempotencyKey: uid("o"), items: [{ itemId: env.seed.itemIds.tarta, qty: 1 }] }, g.body.token);

    const before = await menu();
    const postres = before.find((c) => c.translations.es.name === "Postres");
    expect((await env.api.del(`/staff/items/${env.seed.itemIds.helado}`, manager)).status).toBe(200);
    expect((await menu()).find((c) => c.id === postres.id).items).toHaveLength(postres.items.length - 1);

    expect((await env.api.del(`/staff/categories/${postres.id}`, manager)).status).toBe(200);
    expect((await menu()).find((c) => c.id === postres.id)).toBeUndefined();
    const session = (await env.api.get(`/staff/sessions/${g.body.sessionId}`, manager)).body;
    expect(session.orders[0].items[0].name).toBe("Tarta de queso");

    const ids = (await menu()).map((c) => c.id).reverse();
    expect((await env.api.post("/staff/menu/reorder", { kind: "category", ids }, manager)).status).toBe(200);
    expect((await menu()).map((c) => c.id)).toEqual(ids);
  });
});

describe("gestión: mesas y zonas", () => {
  it("edita y elimina mesas (no si están ocupadas) y zonas", async () => {
    const tables = (await env.api.get("/staff/tables", manager)).body as any[];
    const t5 = tables.find((t) => t.label === "5");
    expect((await env.api.patch(`/staff/tables/${t5.id}`, { label: "5B", capacity: 6 }, manager)).status).toBe(200);
    expect((await env.api.del(`/staff/tables/${t5.id}`, manager)).status).toBe(200);
    // El QR antiguo deja de funcionar y la etiqueta queda libre
    expect((await env.api.get(`/public/q/${env.seed.tableTokens["5"]}`)).status).toBe(404);
    expect((await env.api.post("/staff/tables", { label: "5B" }, manager)).status).toBe(201);

    const busy = tables.find((t) => t.label === "1"); // tiene sesión abierta del test anterior
    expect((await env.api.del(`/staff/tables/${busy.id}`, manager)).body.error).toBe("table_in_use");

    const zones = (await env.api.get("/staff/zones", manager)).body as any[];
    const terraza = zones.find((z) => z.name === "Terraza");
    expect((await env.api.patch(`/staff/zones/${terraza.id}`, { name: "Patio" }, manager)).status).toBe(200);
    expect((await env.api.del(`/staff/zones/${terraza.id}`, manager)).status).toBe(200);
    const after = (await env.api.get("/staff/tables", manager)).body as any[];
    expect(after.find((t) => t.label === "T1").zoneName).toBeNull();
  });
});

describe("gestión: equipo", () => {
  it("edita nombre, correo y contraseña; el encargado no toca al propietario", async () => {
    const users = (await env.api.get("/staff/users", owner)).body as any[];
    const waiter = users.find((u) => u.role === "waiter");
    const own = users.find((u) => u.role === "owner");
    expect((await env.api.patch(`/staff/users/${waiter.membershipId}`, { name: "Lucía", email: "lucia@demo.resan.app", password: "nueva-clave-1" }, manager)).status).toBe(200);
    expect((await env.api.post("/auth/login", { email: "lucia@demo.resan.app", password: "nueva-clave-1" })).status).toBe(200);
    expect((await env.api.patch(`/staff/users/${waiter.membershipId}`, { email: env.seed.credentials.manager.email }, manager)).body.error).toBe("email_in_use");
    expect((await env.api.patch(`/staff/users/${own.membershipId}`, { name: "X" }, manager)).status).toBe(403);
  });
});

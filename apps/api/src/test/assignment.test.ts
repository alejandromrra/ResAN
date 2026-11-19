import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoAssignExpired } from "../services/assignment";
import { computeDelays } from "../services/delays";
import { joinTable, loginPin, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

let env: TestEnv;
let waiter: string; // Camarero Demo (PIN 1111)
let waiter2: string;
let waiter2Id: string;
let kitchen: string;
let manager: string;

beforeAll(async () => {
  env = await setupEnv();
  waiter = await loginPin(env.api, "demo", "1111");
  kitchen = await loginPin(env.api, "demo", "2222");
  manager = await loginStaff(env.api, env.seed.credentials.manager.email, env.seed.credentials.manager.password);
  const owner = await loginStaff(env.api, env.seed.credentials.owner.email, env.seed.credentials.owner.password);
  const created = await env.api.post("/staff/users", { name: "Sara", email: "sara@demo.resan.app", password: "demo12345", role: "waiter", pin: "4444" }, owner);
  waiter2Id = created.body.userId;
  waiter2 = await loginPin(env.api, "demo", "4444");
});
afterAll(async () => env.close());

const tableOf = async (label: string) =>
  ((await env.api.get("/staff/tables", manager)).body as any[]).find((t) => t.label === label);

describe("asignación de mesas", () => {
  it("si la abre el camarero, la lleva él", async () => {
    const t = await tableOf("2");
    await env.api.post(`/staff/tables/${t.id}/session`, {}, waiter);
    const after = await tableOf("2");
    expect(after.assignee).toMatchObject({ name: "Camarero Demo", mode: "opened" });
  });

  it("si la abre un cliente se ofrece a los menos ocupados, y un camarero la coge", async () => {
    const g = await joinTable(env.api, env.seed.tableTokens["3"]!, uid("dev"));
    const sid = g.body.sessionId;
    expect((await tableOf("3")).assignee).toBeNull();

    // Camarero Demo ya lleva la mesa 2; Sara no lleva ninguna: se le ofrece a ella
    const forSara = (await env.api.get("/staff/floor/tasks", waiter2)).body.offers;
    const forDemo = (await env.api.get("/staff/floor/tasks", waiter)).body.offers;
    expect(forSara.find((o: any) => o.sessionId === sid).offeredToMe).toBe(true);
    expect(forDemo.find((o: any) => o.sessionId === sid).offeredToMe).toBe(false);

    expect((await env.api.post(`/staff/sessions/${sid}/claim`, {}, waiter2)).status).toBe(200);
    const taken = await env.api.post(`/staff/sessions/${sid}/claim`, {}, waiter);
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("already_assigned");
    expect((await tableOf("3")).assignee).toMatchObject({ name: "Sara", mode: "claimed" });
  });

  it("a los 5 minutos sin camarero se asigna sola al que menos mesas lleva", async () => {
    const g = await joinTable(env.api, env.seed.tableTokens["4"]!, uid("dev"));
    expect(await autoAssignExpired(env.ctx, new Date())).toBe(0); // aún no han pasado 5 minutos
    expect(await autoAssignExpired(env.ctx, new Date(Date.now() + 6 * 60_000))).toBe(1);
    // Ambos llevan 1 mesa; a igualdad, al que menos ha recibido hoy (los dos 1) → cualquiera de los dos
    const t = await tableOf("4");
    expect(t.assignee.mode).toBe("auto");
    expect(["Camarero Demo", "Sara"]).toContain(t.assignee.name);
    expect(g.body.sessionId).toBe(t.sessionId);
  });

  it("el encargado reasigna; el camarero no puede", async () => {
    const t = await tableOf("3");
    const byWaiter = await env.api.post(`/staff/sessions/${t.sessionId}/assign`, { userId: waiter2Id }, waiter);
    expect(byWaiter.status).toBe(403);
    const me = (await env.api.get("/staff/me", waiter)).body;
    expect((await env.api.post(`/staff/sessions/${t.sessionId}/assign`, { userId: me.userId }, manager)).status).toBe(200);
    expect((await tableOf("3")).assignee).toMatchObject({ name: "Camarero Demo", mode: "manager" });
  });

  it("el camarero que toma el pedido de una mesa sin asignar se la queda", async () => {
    const g = await joinTable(env.api, env.seed.tableTokens["5"]!, uid("dev"));
    await env.api.post(`/staff/sessions/${g.body.sessionId}/orders`, { items: [{ itemId: env.seed.itemIds.agua, qty: 1 }] }, waiter2);
    expect((await tableOf("5")).assignee).toMatchObject({ name: "Sara", mode: "claimed" });
  });
});

describe("retrasos y estadísticas", () => {
  it("detecta platos listos sin llevar y platos atascados, y guarda quién hizo cada paso", async () => {
    const t = await tableOf("6");
    await env.api.post(`/staff/tables/${t.id}/session`, {}, waiter);
    const sid = (await tableOf("6")).sessionId;
    await env.api.post(`/staff/sessions/${sid}/orders`, { items: [{ itemId: env.seed.itemIds.paella, qty: 1 }, { itemId: env.seed.itemIds.croquetas, qty: 1 }] }, waiter);
    const items = (await env.api.get(`/staff/sessions/${sid}`, waiter)).body.orders[0].items as any[];
    const paella = items.find((i) => i.name.includes("Paella"));
    await env.api.patch("/staff/order-items/status", { ids: [paella.id], status: "ready" }, kitchen);

    const later = await computeDelays(env.ctx.db, env.seed.venueId, new Date(Date.now() + 8 * 60_000));
    const mine = later.filter((d) => d.sessionId === sid);
    expect(mine.map((d) => d.kind).sort()).toEqual(["ready_not_served"]);
    // Las croquetas siguen en su tiempo de cocina; si se atascan mucho más allá, avisa
    const stuck = await computeDelays(env.ctx.db, env.seed.venueId, new Date(Date.now() + 40 * 60_000));
    expect(stuck.some((d) => d.sessionId === sid && d.kind === "kitchen_slow")).toBe(true);
    expect(mine.find((d) => d.kind === "ready_not_served")!.assigneeName).toBe("Camarero Demo");

    const kd = (await env.api.get("/staff/delays?audience=kitchen", kitchen)).body;
    expect(Array.isArray(kd)).toBe(true);

    await env.api.patch("/staff/order-items/status", { ids: [paella.id], status: "served" }, waiter);
    const stats = (await env.api.get("/staff/stats", manager)).body;
    const demo = stats.staff.find((s: any) => s.name === "Camarero Demo");
    const cook = stats.staff.find((s: any) => s.name === "Cocina Demo");
    expect(demo.itemsServed).toBe(1);
    expect(demo.onTimePct).toBe(100);
    expect(demo.openTables).toBeGreaterThan(0);
    expect(cook.itemsPrepared).toBe(1);
    expect((await env.api.get("/staff/stats", waiter)).status).toBe(403);
    expect((await env.api.get("/staff/stats?shift=00000000-0000-4000-8000-000000000000", manager)).status).toBe(404);
  });
});

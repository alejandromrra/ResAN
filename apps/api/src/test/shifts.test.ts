import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinTable, loginPin, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

let env: TestEnv;
let waiter: string;
let kitchen: string;
let manager: string;

beforeAll(async () => {
  env = await setupEnv({ shift: false });
  waiter = await loginPin(env.api, "demo", "1111");
  kitchen = await loginPin(env.api, "demo", "2222");
  manager = await loginStaff(env.api, env.seed.credentials.manager.email, env.seed.credentials.manager.password);
});
afterAll(async () => env.close());

describe("turnos", () => {
  it("sin turno el cliente ve la carta pero no puede pedir ni abrir mesa", async () => {
    const qr = env.seed.tableTokens["1"]!;
    const menu = await env.api.get(`/public/q/${qr}`);
    expect(menu.body.serviceOpen).toBe(false);
    const join = await joinTable(env.api, qr, uid("dev"));
    expect(join.status).toBe(409);
    expect(join.body.error).toBe("shift_closed");
    const t = ((await env.api.get("/staff/tables", waiter)).body as any[])[0];
    expect((await env.api.post(`/staff/tables/${t.id}/session`, {}, waiter)).body.error).toBe("shift_closed");
  });

  it("solo el encargado abre y cierra el turno", async () => {
    expect((await env.api.post("/staff/shift/open", {}, waiter)).status).toBe(403);
    expect((await env.api.post("/staff/shift/open", {}, kitchen)).status).toBe(403);
    const opened = await env.api.post("/staff/shift/open", {}, manager);
    expect(opened.status).toBe(201);
    expect(opened.body.openedBy).toBe("Encargado Demo");
    expect((await env.api.post("/staff/shift/open", {}, manager)).body.error).toBe("shift_already_open");
    expect((await env.api.get("/staff/shift", waiter)).body.current.id).toBe(opened.body.id);
    expect((await env.api.get(`/public/q/${env.seed.tableTokens["1"]}`)).body.serviceOpen).toBe(true);
  });

  it("no se cierra con mesas abiertas; al cerrar guarda el resumen y la caja de cada camarero", async () => {
    const g = await joinTable(env.api, env.seed.tableTokens["2"]!, uid("dev"));
    const sid = g.body.sessionId;
    await env.api.post("/public/orders", { idempotencyKey: uid("o"), items: [{ itemId: env.seed.itemIds.cerveza, qty: 2 }] }, g.body.token);
    await env.api.post(`/staff/sessions/${sid}/claim`, {}, waiter);

    const blocked = await env.api.post("/staff/shift/close", {}, manager);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "open_tables", details: { tables: ["2"] } });

    const bill = await env.api.post(`/staff/sessions/${sid}/bill`, {}, waiter);
    await env.api.post(`/staff/bills/${bill.body.id}/payments`, { method: "cash", amountCents: 300, tipCents: 50 }, waiter);
    await env.api.post(`/staff/bills/${bill.body.id}/payments`, { method: "card", amountCents: bill.body.totalCents - 300 }, waiter);

    const cash = (await env.api.get("/staff/shift/cash", waiter)).body;
    expect(cash.byMethod).toEqual({ cash: 300, card: bill.body.totalCents - 300, other: 0 });
    expect(cash.tipsCents).toBe(50);
    expect(cash.payments).toHaveLength(2);
    expect(cash.payments[0].tableLabel).toBe("2");

    const closed = await env.api.post("/staff/shift/close", {}, manager);
    expect(closed.status).toBe(200);
    expect(closed.body.live).toBe(false);
    expect(closed.body.shift.closedBy).toBe("Encargado Demo");
    const w = closed.body.staff.find((s: any) => s.name === "Camarero Demo");
    expect(w.byMethod.cash).toBe(300);
    expect(w.tablesAssigned).toBe(1);

    // Tras cerrar: el estado lo refleja, la caja sigue disponible y el resumen queda guardado
    const state = (await env.api.get("/staff/shift", waiter)).body;
    expect(state.current).toBeNull();
    expect(state.last.id).toBe(closed.body.shift.id);
    expect((await env.api.get("/staff/shift/cash", waiter)).body.totalCents).toBe(bill.body.totalCents);
    const stats = (await env.api.get("/staff/stats", manager)).body;
    expect(stats.shift.id).toBe(closed.body.shift.id);
    expect((await env.api.get("/staff/shifts", manager)).body).toHaveLength(1);
    expect((await env.api.get("/staff/stats", waiter)).status).toBe(403);
    // Sin turno, el cliente ya no puede pedir
    expect((await joinTable(env.api, env.seed.tableTokens["3"]!, uid("dev"))).body.error).toBe("shift_closed");
  });

  it("se puede cerrar el turno cerrando sin cobrar las mesas que queden; el siguiente empieza vacío", async () => {
    await env.api.post("/staff/shift/open", {}, manager);
    for (const label of ["4", "5"]) {
      const g = await joinTable(env.api, env.seed.tableTokens[label]!, uid("dev"));
      await env.api.post("/public/orders", { idempotencyKey: uid("o"), items: [{ itemId: env.seed.itemIds.paella, qty: 1 }, { itemId: env.seed.itemIds.agua, qty: 1 }] }, g.body.token);
    }
    expect(((await env.api.get("/staff/kitchen", kitchen)).body as any[]).length).toBe(2);
    expect((await env.api.post("/staff/shift/close", {}, manager)).body.error).toBe("open_tables");

    const forced = await env.api.post("/staff/shift/close", { force: true }, manager);
    expect(forced.status).toBe(200);
    const tables = (await env.api.get("/staff/tables", manager)).body as any[];
    expect(tables.every((t) => t.status === "free")).toBe(true);
    // Lo que no se sirvió queda anulado: ni cocina ni sala lo siguen viendo
    expect((await env.api.get("/staff/kitchen", kitchen)).body).toEqual([]);

    await env.api.post("/staff/shift/open", {}, manager);
    const tasks = (await env.api.get("/staff/floor/tasks", manager)).body;
    expect(tasks.delays).toEqual([]);
    expect(tasks.serve).toEqual([]);
    expect(tasks.ready).toEqual([]);
    const stats = (await env.api.get("/staff/stats", manager)).body;
    expect(stats.totals).toMatchObject({ tablesServed: 0, itemsServed: 0, activeDelays: 0 });
    await env.api.post("/staff/shift/close", {}, manager);
  });

  it("al iniciar turno se cierran las mesas que hubieran quedado abiertas de antes", async () => {
    const { tableSessions, tables } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [t] = await env.ctx.db.select().from(tables).where(eq(tables.label, "6"));
    await env.ctx.db.insert(tableSessions).values({ venueId: env.seed.venueId, tableId: t!.id });
    expect(((await env.api.get("/staff/tables", manager)).body as any[]).find((x) => x.label === "6").status).not.toBe("free");
    await env.api.post("/staff/shift/open", {}, manager);
    expect(((await env.api.get("/staff/tables", manager)).body as any[]).find((x) => x.label === "6").status).toBe("free");
  });
});

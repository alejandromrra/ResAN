import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceKitchen } from "../services/kitchen";
import { localParts } from "../lib/time";
import { joinTable, loginPin, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

let env: TestEnv;
let waiter: string;
let waiterId: string;
let waiter2Id: string;
let manager: string;
let kitchen: string;

beforeAll(async () => {
  env = await setupEnv();
  waiter = await loginPin(env.api, "demo", "1111");
  kitchen = await loginPin(env.api, "demo", "2222");
  manager = await loginStaff(env.api, env.seed.credentials.manager.email, env.seed.credentials.manager.password);
  const owner = await loginStaff(env.api, env.seed.credentials.owner.email, env.seed.credentials.owner.password);
  waiter2Id = (await env.api.post("/staff/users", { name: "Sara", email: "sara2@demo.resan.app", password: "demo12345", role: "waiter", pin: "4444" }, owner)).body.userId;
  waiterId = (await env.api.get("/staff/me", waiter)).body.userId;
});
afterAll(async () => env.close());

const tableOf = async (label: string) =>
  ((await env.api.get("/staff/tables", manager)).body as any[]).find((t) => t.label === label);

describe("zonas de camareros", () => {
  it("con asignación por zonas, la mesa del cliente va al camarero conectado de su zona", async () => {
    const zones = (await env.api.get("/staff/zones", manager)).body as any[];
    const terraza = zones.find((z) => z.name === "Terraza");
    const salon = zones.find((z) => z.name !== "Terraza");
    expect((await env.api.call("PUT", `/staff/zones/${terraza.id}/staff`, { token: manager, body: { userIds: [waiter2Id] } })).status).toBe(200);
    expect((await env.api.call("PUT", `/staff/zones/${salon.id}/staff`, { token: manager, body: { userIds: [waiterId] } })).status).toBe(200);
    // El camarero no puede activar la asignación por zonas
    expect((await env.api.patch("/staff/venue/service", { assignByZone: true }, waiter)).status).toBe(403);
    const me = await env.api.patch("/staff/venue/service", { assignByZone: true }, manager);
    expect(me.body.assignByZone).toBe(true);

    env.ctx.bus.join(env.seed.venueId, waiter2Id);
    await joinTable(env.api, env.seed.tableTokens["T1"]!, uid("dev"));
    expect((await tableOf("T1")).assignee).toMatchObject({ name: "Sara", mode: "zone" });

    // Nadie del salón conectado: se ofrece solo a los del salón y espera
    await joinTable(env.api, env.seed.tableTokens["1"]!, uid("dev"));
    expect((await tableOf("1")).assignee).toBeNull();
    const tasks = (await env.api.get("/staff/floor/tasks", waiter)).body;
    expect(tasks.assignByZone).toBe(true);
    expect(tasks.offers.find((o: any) => o.tableLabel === "1").offeredToMe).toBe(true);
    expect(tasks.zones.find((z: any) => z.id === terraza.id).staff.map((s: any) => s.name)).toEqual(["Sara"]);
    // Al conectarse el camarero de la zona, el trabajo de fondo se la da
    env.ctx.bus.join(env.seed.venueId, waiterId);
    const { autoAssignExpired } = await import("../services/assignment");
    await autoAssignExpired(env.ctx);
    expect((await tableOf("1")).assignee).toMatchObject({ name: "Camarero Demo", mode: "zone" });
  });
});

describe("cocina automática", () => {
  it("los platos avanzan solos según sus minutos y el encargado fija el tiempo por plato", async () => {
    const menu = (await env.api.get("/staff/menu", manager)).body as any[];
    const paella = menu.flatMap((c) => c.items).find((i: any) => i.id === env.seed.itemIds.paella);
    expect(paella.prepMinutes).toBe(20);
    expect((await env.api.patch(`/staff/items/${paella.id}`, { prepMinutes: 25 }, manager)).status).toBe(200);
    expect((await env.api.patch("/staff/venue/service", { defaultPrepMinutes: 8 }, manager)).status).toBe(200);

    const t = await tableOf("2");
    await env.api.post(`/staff/tables/${t.id}/session`, {}, waiter);
    const sid = (await tableOf("2")).sessionId;
    await env.api.post(`/staff/sessions/${sid}/orders`, { items: [{ itemId: env.seed.itemIds.paella, qty: 1 }, { itemId: env.seed.itemIds.croquetas, qty: 2 }] }, waiter);

    const ticket = (await env.api.get("/staff/kitchen", kitchen)).body.find((k: any) => k.sessionId === sid);
    const mins = (i: any) => Math.round((Date.parse(i.dueAt) - Date.parse(i.startedAt)) / 60000);
    expect(ticket.items.every((i: any) => i.status === "preparing")).toBe(true);
    expect(ticket.items.map(mins).sort((a: number, b: number) => a - b)).toEqual([6, 25]);

    // A los 9 minutos las croquetas están listas; la paella sigue
    await advanceKitchen(env.ctx, new Date(Date.now() + 9 * 60_000));
    const after = (await env.api.get("/staff/kitchen", kitchen)).body.find((k: any) => k.sessionId === sid);
    expect(after.items.map((i: any) => i.status).sort()).toEqual(["preparing", "ready"]);
    const tasks = (await env.api.get("/staff/floor/tasks", waiter)).body;
    expect(tasks.ready.filter((r: any) => r.sessionId === sid).map((r: any) => r.qty)).toEqual([2]);

    await advanceKitchen(env.ctx, new Date(Date.now() + 26 * 60_000));
    const done = (await env.api.get("/staff/kitchen", kitchen)).body.find((k: any) => k.sessionId === sid);
    expect(done.items.every((i: any) => i.status === "ready")).toBe(true);
  });
});

describe("reservas y n8n", () => {
  let key: string;
  const n8n = (method: any, url: string, body?: unknown) => env.api.call(method, `/integrations/v1${url}`, { body, headers: { authorization: `Bearer ${key}` } });
  // Un día dentro de 10 días (siempre en el futuro y con margen de antelación)
  const day = localParts(new Date(Date.now() + 10 * 86400_000), "Europe/Madrid").date;

  it("sin clave no se entra; el encargado genera una y solo se guarda el hash", async () => {
    expect((await env.api.get(`/integrations/v1/guidelines`)).status).toBe(401);
    expect((await env.api.post("/staff/integrations/key", {}, waiter)).status).toBe(403);
    const r = await env.api.post("/staff/integrations/key", {}, manager);
    expect(r.status).toBe(201);
    key = r.body.key;
    expect(key.startsWith("rsn_")).toBe(true);
    expect((await env.api.get("/staff/integrations", manager)).body.key.prefix).toBe(key.slice(0, 10));
  });

  it("el agente consulta huecos, reserva, modifica y cancela", async () => {
    await env.api.patch("/staff/reservations/settings", { maxCovers: 6, hours: { mon: "13:00-16:00", tue: "13:00-16:00", wed: "13:00-16:00", thu: "13:00-16:00", fri: "13:00-16:00", sat: "13:00-16:00", sun: "13:00-16:00" } }, manager);
    const av = await n8n("GET", `/availability?date=${day}&party=4`);
    expect(av.status).toBe(200);
    expect(av.body.open).toBe(true);
    expect(av.body.slots.map((s: any) => s.time)).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]);

    const created = await n8n("POST", "/reservations", { name: "Lucía", phone: "+34 600 111 222", partySize: 4, date: day, time: "14:00", notes: "cumpleaños" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ date: day, time: "14:00", status: "confirmed", source: "n8n" });
    const code = created.body.code;

    // Solo caben 6 a la vez: otra de 4 que se solapa no entra y se ofrecen alternativas
    const full = await n8n("POST", "/reservations", { name: "Pepe", phone: "600333444", partySize: 4, date: day, time: "14:30" });
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("slot_full");
    expect(full.body.details.slots).toContain("15:30");

    expect((await n8n("GET", `/reservations?phone=600111222`)).body.map((r: any) => r.code)).toEqual([code]);
    const moved = await n8n("PATCH", `/reservations/${code.toLowerCase()}`, { time: "15:30", partySize: 5 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ time: "15:30", partySize: 5 });

    const staffList = (await env.api.get(`/staff/reservations?date=${day}`, waiter)).body;
    expect(staffList.reservations.map((r: any) => r.name)).toEqual(["Lucía"]);

    // Búsqueda del personal por teléfono (con o sin espacios) y por nombre
    expect((await env.api.get(`/staff/reservations/search?q=${encodeURIComponent("600 111")}`, waiter)).body.map((r: any) => r.code)).toEqual([code]);
    expect((await env.api.get(`/staff/reservations/search?q=luc`, waiter)).body.map((r: any) => r.name)).toEqual(["Lucía"]);
    expect((await env.api.get(`/staff/reservations/search?q=zzz`, waiter)).body).toEqual([]);

    const cancelled = await n8n("DELETE", `/reservations/${code}`);
    expect(cancelled.body.status).toBe("cancelled");
    expect((await n8n("GET", `/reservations?phone=600111222`)).body).toEqual([]);
  });

  it("las pautas del día cierran las reservas y llegan al prompt del agente", async () => {
    expect((await env.api.post("/staff/notes", { date: day, text: "Hoy no hacemos reservas, es por orden de llegada", noReservations: true }, waiter)).status).toBe(403);
    await env.api.post("/staff/notes", { date: null, text: "Tenemos opciones sin gluten." }, manager);
    const note = await env.api.post("/staff/notes", { date: day, text: "Hoy no hacemos reservas, es por orden de llegada", noReservations: true }, manager);
    expect(note.status).toBe(201);

    const g = (await n8n("GET", `/guidelines?date=${day}`)).body;
    expect(g.reservationsOpen).toBe(false);
    expect(g.text).toContain("orden de llegada");
    expect(g.text).toContain("sin gluten");
    const av = (await n8n("GET", `/availability?date=${day}&party=2`)).body;
    expect(av).toMatchObject({ open: false, slots: [] });
    expect((await n8n("POST", "/reservations", { name: "X", partySize: 2, date: day, time: "13:00" })).body.error).toBe("reservations_closed");

    // El personal sí puede apuntar una a mano (p. ej. un compromiso)
    expect((await env.api.post("/staff/reservations", { name: "Amigo del jefe", partySize: 2, date: day, time: "13:00" }, waiter)).status).toBe(201);

    await env.api.del(`/staff/notes/${note.body.id}`, manager);
    expect((await n8n("GET", `/guidelines?date=${day}`)).body.reservationsOpen).toBe(true);
  });

  it("al regenerar la clave, la anterior deja de valer", async () => {
    const old = key;
    key = (await env.api.post("/staff/integrations/key", {}, manager)).body.key;
    expect((await env.api.call("GET", "/integrations/v1/guidelines", { headers: { "x-api-key": old } })).status).toBe(401);
    expect((await env.api.call("GET", "/integrations/v1/guidelines", { headers: { "x-api-key": key } })).status).toBe(200);
  });
});

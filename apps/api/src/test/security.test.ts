import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { joinTable, loginPin, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

let a: TestEnv;
let owner: string;
let waiter: string;
let kitchen: string;

beforeAll(async () => {
  a = await setupEnv();
  owner = await loginStaff(a.api, a.seed.credentials.owner.email, a.seed.credentials.owner.password);
  waiter = await loginPin(a.api, "demo", "1111");
  kitchen = await loginPin(a.api, "demo", "2222");
});
afterAll(async () => a.close());

describe("autenticación", () => {
  it("rechaza contraseñas y PIN erróneos con el mismo error", async () => {
    const bad = await a.api.post("/auth/login", { email: a.seed.credentials.owner.email, password: "mal" });
    expect(bad.status).toBe(401);
    expect((await a.api.post("/auth/pin", { venueSlug: "demo", pin: "9999" })).status).toBe(401);
    expect((await a.api.post("/auth/pin", { venueSlug: "no-existe", pin: "1111" })).status).toBe(401);
  });

  it("las rutas de personal exigen token de personal y las de comensal uno de comensal", async () => {
    expect((await a.api.get("/staff/me")).status).toBe(401);
    expect((await a.api.get("/staff/tables", "basura")).status).toBe(401);
    const guest = await joinTable(a.api, a.seed.tableTokens["1"]!, uid("dev"));
    expect((await a.api.get("/staff/tables", guest.body.token)).status).toBe(401);
    expect((await a.api.get("/public/session", waiter)).status).toBe(401);
  });
});

describe("permisos por rol", () => {
  it("cocina no toca mesas ni cuentas; camarero no edita carta ni usuarios", async () => {
    expect((await a.api.get("/staff/tables", kitchen)).status).toBe(403);
    expect((await a.api.get("/staff/kitchen", waiter)).status).toBe(200); // sala ve cocina (solo lectura)
    expect((await a.api.get("/staff/menu", kitchen)).status).toBe(403);
    expect((await a.api.post("/staff/categories", { names: { es: { name: "X" } } }, waiter)).status).toBe(403);
    expect((await a.api.get("/staff/users", waiter)).status).toBe(403);
    expect((await a.api.patch("/staff/venue", { name: "X" }, waiter)).status).toBe(403);
    expect((await a.api.get("/staff/menu", owner)).status).toBe(200);
    // Un id mal formado no debe tumbar la petición con un 500
    expect((await a.api.patch("/staff/users/no-es-uuid", { role: "waiter" }, owner)).status).toBe(404);
  });
});

describe("usuarios y PIN", () => {
  it("impide PIN repetidos en el mismo local y dejar el local sin propietario", async () => {
    const dup = await a.api.post(
      "/staff/users",
      { email: "otro@demo.resan.app", password: "clave12345", name: "Otro", role: "waiter", pin: "1111" },
      owner,
    );
    expect(dup.status).toBe(409);

    const created = await a.api.post("/staff/users", { email: "nuevo@demo.resan.app", password: "clave12345", name: "Nuevo", role: "waiter", pin: "3333" }, owner);
    expect(created.status).toBe(201);
    expect(await loginPin(a.api, "demo", "3333")).toBeTruthy();

    const list = await a.api.get("/staff/users", owner);
    const me = { body: { userId: list.body.find((u: any) => u.role === "owner").membershipId } };
    const demote = await a.api.patch(`/staff/users/${me.body.userId}`, { role: "waiter" }, owner);
    expect(demote.status, JSON.stringify(demote.body)).toBe(409);
    expect((await a.api.del(`/staff/users/${me.body.userId}`, owner)).status).toBe(409);
  });
});

describe("aislamiento entre locales", () => {
  it("un local no ve ni toca mesas, platos ni sesiones de otro", async () => {
    // Segundo local en la misma base de datos
    const { seedDemo } = await import("../db/seed");
    const b = await seedDemo(a.ctx.db, { slug: "otro", emailDomain: "otro.resan.app", name: "Otro bar" });
    expect(b).not.toBeNull();
    const ownerB = await loginStaff(a.api, b!.credentials.owner.email, b!.credentials.owner.password);

    const tablesB = await a.api.get("/staff/tables", ownerB);
    expect(tablesB.status).toBe(200);
    const idsB = new Set(tablesB.body.map((t: any) => t.id));
    expect(Object.values(a.seed.tableIds).some((id) => idsB.has(id))).toBe(false);

    // Abrir una mesa del local A con el token de B
    const open = await a.api.post(`/staff/tables/${a.seed.tableIds["1"]}/session`, undefined, ownerB);
    expect(open.status).toBe(404);
    // Cambiar disponibilidad de un plato de A
    const item = await a.api.patch(`/staff/items/${a.seed.itemIds.paella}/availability`, { available: false }, ownerB);
    expect(item.status).toBe(404);

    // Sesión de A leída desde B
    const guest = await joinTable(a.api, a.seed.tableTokens["1"]!, uid("dev"));
    expect((await a.api.get(`/staff/sessions/${guest.body.sessionId}`, ownerB)).status).toBe(404);
    // Pedir un plato de B desde una mesa de A
    const cross = await a.api.post(
      "/public/orders",
      { idempotencyKey: uid("o"), items: [{ itemId: b!.itemIds.paella, qty: 1 }] },
      guest.body.token,
    );
    expect(cross.status).toBe(422);
  });
});

describe("tiempo real (WebSocket)", () => {
  async function listen() {
    if (!a.app.server.listening) await a.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = a.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return `ws://127.0.0.1:${port}/ws`;
  }

  function client(url: string, token: string, since?: number) {
    const messages: any[] = [];
    const ws = new WebSocket(url);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token, since })));
    ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
    const waitFor = async (pred: (m: any) => boolean, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = messages.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("timeout esperando mensaje; recibidos: " + JSON.stringify(messages));
    };
    return { ws, messages, waitFor };
  }

  it("personal recibe eventos del local; el comensal solo los de su mesa", async () => {
    const url = await listen();
    const g1 = await joinTable(a.api, a.seed.tableTokens["4"]!, uid("dev"));
    const g2 = await joinTable(a.api, a.seed.tableTokens["5"]!, uid("dev"));

    const staff = client(url, waiter);
    const guest1 = client(url, g1.body.token);
    const guest2 = client(url, g2.body.token);
    await staff.waitFor((m) => m.type === "ready");
    await guest1.waitFor((m) => m.type === "ready");
    await guest2.waitFor((m) => m.type === "ready");

    await a.api.post(
      "/public/orders",
      { idempotencyKey: uid("o"), items: [{ itemId: a.seed.itemIds.agua, qty: 1 }] },
      g1.body.token,
    );

    const ev = await staff.waitFor((m) => m.type === "event" && m.event.type === "order.created");
    expect(ev.event.sessionId).toBe(g1.body.sessionId);
    await guest1.waitFor((m) => m.type === "event" && m.event.type === "order.created");
    await new Promise((r) => setTimeout(r, 150));
    expect(guest2.messages.some((m) => m.type === "event" && m.event.type === "order.created")).toBe(false);

    [staff, guest1, guest2].forEach((c) => c.ws.close());
  });

  it("un token inválido se cierra y una reconexión con 'since' repite lo perdido", async () => {
    const url = await listen();
    const bad = client(url, "basura");
    await new Promise<void>((resolve) => bad.ws.on("close", () => resolve()));

    const first = client(url, waiter);
    const ready = await first.waitFor((m) => m.type === "ready");
    const lastSeq: number = ready.seq;
    first.ws.close();

    // Ocurre algo mientras el cliente estaba desconectado
    const g = await joinTable(a.api, a.seed.tableTokens["T1"]!, uid("dev"));
    await a.api.post(
      "/public/orders",
      { idempotencyKey: uid("o"), items: [{ itemId: a.seed.itemIds.agua, qty: 1 }] },
      g.body.token,
    );

    const second = client(url, waiter, lastSeq);
    await second.waitFor((m) => m.type === "ready");
    await second.waitFor((m) => m.type === "event" && m.event.type === "order.created");

    // Si el cliente está más adelante que el servidor (reinicio), se pide resincronizar
    const stale = client(url, waiter, 999999);
    await stale.waitFor((m) => m.type === "resync");

    [second, stale].forEach((c) => c.ws.close());
  });
});

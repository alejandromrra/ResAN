import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinTable, loginPin, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

let env: TestEnv;
let kitchen: string;
let waiter: string;
let manager: string;

beforeAll(async () => {
  env = await setupEnv();
  kitchen = await loginPin(env.api, "demo", "2222");
  waiter = await loginPin(env.api, "demo", "1111");
  manager = await loginStaff(env.api, env.seed.credentials.manager.email, env.seed.credentials.manager.password);
});
afterAll(async () => env.close());

describe("carta pública por QR", () => {
  it("devuelve la carta en el idioma pedido con respaldo en el del local", async () => {
    const t = env.seed.tableTokens["1"]!;
    const es = await env.api.get(`/public/q/${t}?lang=es`);
    expect(es.status).toBe(200);
    expect(es.body.table.label).toBe("1");
    expect(es.body.language).toBe("es");
    expect(es.body.session).toBeNull();
    expect(es.body.menu.categories.map((c: any) => c.name)).toEqual(["Entrantes", "Principales", "Postres", "Bebidas"]);

    const de = await env.api.get(`/public/q/${t}?lang=de`);
    expect(de.body.language).toBe("de");
    expect(de.body.menu.categories[0].name).toBe("Vorspeisen");
    const croquetas = de.body.menu.categories[0].items.find((i: any) => i.id === env.seed.itemIds.croquetas);
    expect(croquetas.name).toBe("Schinkenkroketten");
    // La descripción en alemán no existe: cae al español
    expect(croquetas.description).toContain("croquetas");
    expect(croquetas.allergens).toEqual(["gluten", "milk", "eggs"]);
  });

  it("usa Accept-Language y un idioma no ofrecido cae al del local", async () => {
    const t = env.seed.tableTokens["1"]!;
    const fr = await env.api.call("GET", `/public/q/${t}`, { headers: { "accept-language": "fr-FR,fr;q=0.9" } });
    expect(fr.body.language).toBe("fr");
    const xx = await env.api.get(`/public/q/${t}?lang=ja`);
    expect(xx.body.language).toBe("es");
  });

  it("un QR desconocido da 404", async () => {
    expect((await env.api.get("/public/q/no-existe")).status).toBe(404);
  });
});

describe("flujo completo: del QR al cobro", () => {
  it("varios comensales piden, cocina y sala avanzan los pedidos y el cobro cierra la mesa", async () => {
    const qr = env.seed.tableTokens["2"]!;
    const { itemIds } = env.seed;

    // Dos comensales entran: la sesión se abre sola con el primero
    const a = await joinTable(env.api, qr, uid("dev"), { language: "es" });
    const b = await joinTable(env.api, qr, uid("dev"), { language: "en", alias: "Ana" });
    expect(a.status).toBe(200);
    expect(a.body.guest.alias).toBe("Comensal 1");
    expect(b.body.guest.alias).toBe("Ana");
    expect(b.body.sessionId).toBe(a.body.sessionId);
    const sessionId = a.body.sessionId as string;

    // Volver a escanear con el mismo dispositivo reutiliza al comensal
    const deviceId = uid("same");
    const first = await joinTable(env.api, qr, deviceId);
    const again = await joinTable(env.api, qr, deviceId);
    expect(again.body.guest.id).toBe(first.body.guest.id);

    // A pide plato de cocina y bebida; B pide postre
    const o1 = await env.api.post(
      "/public/orders",
      {
        idempotencyKey: uid("order"),
        items: [
          { itemId: itemIds.hamburguesa, qty: 2, note: "sin cebolla" },
          { itemId: itemIds.cerveza, qty: 2 },
        ],
      },
      a.body.token,
    );
    expect(o1.status).toBe(201);
    expect(o1.body.round).toBe(1);
    expect(o1.body.status).toBe("accepted");

    // Cocina solo ve lo que se cocina
    const k1 = await env.api.get("/staff/kitchen", kitchen);
    const ticket = k1.body.find((t: any) => t.orderId === o1.body.orderId);
    expect(ticket.tableLabel).toBe("2");
    expect(ticket.items).toHaveLength(1);
    expect(ticket.items[0]).toMatchObject({ name: "Hamburguesa de la casa", qty: 2, note: "sin cebolla", status: "new" });

    // Sala ve la cerveza pendiente de servir, no la hamburguesa
    const tasks = await env.api.get("/staff/floor/tasks", waiter);
    expect(tasks.body.serve.map((s: any) => s.name)).toContain("Caña de cerveza");
    expect(tasks.body.ready).toHaveLength(0);

    const o2 = await env.api.post(
      "/public/orders",
      { idempotencyKey: uid("order"), items: [{ itemId: itemIds.tarta, qty: 1 }] },
      b.body.token,
    );
    expect(o2.body.round).toBe(2);

    // Cocina empieza y termina; el camarero no puede cocinar
    const burgerId = ticket.items[0].id;
    const waiterCooks = await env.api.patch("/staff/order-items/status", { ids: [burgerId], status: "preparing" }, waiter);
    expect(waiterCooks.status).toBe(403);
    expect(waiterCooks.body.error).toBe("transition_not_allowed");

    expect((await env.api.patch("/staff/order-items/status", { ids: [burgerId], status: "preparing" }, kitchen)).status).toBe(200);
    expect((await env.api.patch("/staff/order-items/status", { ids: [burgerId], status: "ready" }, kitchen)).status).toBe(200);
    // Repetir el mismo cambio no falla (doble toque)
    expect((await env.api.patch("/staff/order-items/status", { ids: [burgerId], status: "ready" }, kitchen)).status).toBe(200);

    // La mesa pasa a "listo para servir" y aparece en las tareas de sala
    const tables = await env.api.get("/staff/tables", waiter);
    expect(tables.body.find((t: any) => t.label === "2").status).toBe("ready_to_serve");
    const tasks2 = await env.api.get("/staff/floor/tasks", waiter);
    expect(tasks2.body.ready.map((r: any) => r.itemId)).toContain(burgerId);

    // La cocina no sirve; el camarero sí
    expect((await env.api.patch("/staff/order-items/status", { ids: [burgerId], status: "served" }, kitchen)).status).toBe(403);
    expect((await env.api.patch("/staff/order-items/status", { ids: [burgerId], status: "served" }, waiter)).status).toBe(200);

    // El camarero sirve las bebidas y el postre (no pasan por cocina)
    const detail0 = await env.api.get(`/staff/sessions/${sessionId}`, waiter);
    const serveIds = detail0.body.orders.flatMap((o: any) => o.items).filter((i: any) => i.fulfillment === "serve").map((i: any) => i.id);
    expect(serveIds).toHaveLength(2);
    expect((await env.api.patch("/staff/order-items/status", { ids: serveIds, status: "served" }, waiter)).status).toBe(200);

    // El comensal ve el estado de toda la mesa en su idioma
    const mine = await env.api.get("/public/session", b.body.token);
    expect(mine.status).toBe(200);
    expect(mine.body.me.alias).toBe("Ana");
    expect(mine.body.items.every((i: any) => i.status === "served")).toBe(true);
    expect(mine.body.items.map((i: any) => i.name)).toContain("Cheesecake");
    expect(mine.body.totalCents).toBe(2 * 1250 + 2 * 280 + 550);

    // Pide la cuenta desde el móvil: la mesa pasa a "cuenta pedida" y no se duplica
    const bill1 = await env.api.post("/public/calls", { type: "bill" }, a.body.token);
    const bill2 = await env.api.post("/public/calls", { type: "bill" }, b.body.token);
    expect(bill1.status).toBe(201);
    expect(bill2.status).toBe(200);
    expect(bill2.body.id).toBe(bill1.body.id);
    const tables2 = await env.api.get("/staff/tables", waiter);
    expect(tables2.body.find((t: any) => t.label === "2").status).toBe("bill_requested");

    // El camarero atiende el aviso y genera la cuenta
    expect((await env.api.post(`/staff/calls/${bill1.body.id}/ack`, undefined, waiter)).status).toBe(200);
    const bill = await env.api.post(`/staff/sessions/${sessionId}/bill`, {}, waiter);
    expect(bill.status).toBe(201);
    expect(bill.body.subtotalCents).toBe(2500 + 560 + 550);
    expect(bill.body.totalCents).toBe(3610);
    expect(bill.body.byGuest).toHaveLength(2);
    expect(bill.body.tableLabel).toBe("2");
    expect((await env.api.post(`/staff/bills/${bill.body.id}/printed`, undefined, waiter)).body.status).toBe("printed");

    // Cobra en dos veces: primero parte en tarjeta, luego el resto en efectivo
    const part = await env.api.post(`/staff/bills/${bill.body.id}/payments`, { method: "card", amountCents: 2000, tipCents: 200 }, waiter);
    expect(part.status).toBe(200);
    expect(part.body.status).toBe("printed");
    expect(part.body.paidCents).toBe(2000);
    const tooMuch = await env.api.post(`/staff/bills/${bill.body.id}/payments`, { method: "cash", amountCents: 9999 }, waiter);
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toBe("amount_exceeds_due");

    const done = await env.api.post(`/staff/bills/${bill.body.id}/payments`, { method: "cash", amountCents: 1610 }, waiter);
    expect(done.body.status).toBe("paid");
    expect(done.body.tipCents).toBe(200);

    // La mesa queda libre y los móviles de los comensales dejan de valer
    const tables3 = await env.api.get("/staff/tables", waiter);
    expect(tables3.body.find((t: any) => t.label === "2").status).toBe("free");
    const gone = await env.api.get("/public/session", a.body.token);
    expect(gone.status).toBe(410);
    expect(gone.body.error).toBe("session_closed");
    const noMore = await env.api.post("/public/orders", { idempotencyKey: uid("order"), items: [{ itemId: itemIds.agua, qty: 1 }] }, a.body.token);
    expect(noMore.status).toBe(410);

    // Un nuevo escaneo abre una sesión nueva
    const next = await joinTable(env.api, qr, uid("dev"));
    expect(next.body.sessionId).not.toBe(sessionId);
  });
});

describe("pedidos", () => {
  it("es idempotente: reenviar la misma clave no duplica el pedido", async () => {
    const guest = await joinTable(env.api, env.seed.tableTokens["3"]!, uid("dev"));
    const key = uid("order");
    const body = { idempotencyKey: key, items: [{ itemId: env.seed.itemIds.paella, qty: 1 }] };
    const first = await env.api.post("/public/orders", body, guest.body.token);
    const second = await env.api.post("/public/orders", body, guest.body.token);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.orderId).toBe(first.body.orderId);

    const session = await env.api.get(`/staff/sessions/${guest.body.sessionId}`, waiter);
    expect(session.body.orders).toHaveLength(1);
  });

  it("dos comensales pidiendo a la vez obtienen rondas distintas", async () => {
    const qr = env.seed.tableTokens["4"]!;
    const a = await joinTable(env.api, qr, uid("dev"));
    const b = await joinTable(env.api, qr, uid("dev"));
    const mk = (token: string) =>
      env.api.post("/public/orders", { idempotencyKey: uid("order"), items: [{ itemId: env.seed.itemIds.agua, qty: 1 }] }, token);
    const [r1, r2] = await Promise.all([mk(a.body.token), mk(b.body.token)]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(new Set([r1.body.round, r2.body.round])).toEqual(new Set([1, 2]));
  });

  it("valida cantidades, líneas vacías y platos de otro local o inexistentes", async () => {
    const guest = await joinTable(env.api, env.seed.tableTokens["5"]!, uid("dev"));
    const post = (items: unknown) => env.api.post("/public/orders", { idempotencyKey: uid("order"), items }, guest.body.token);
    expect((await post([])).status).toBe(400);
    expect((await post([{ itemId: env.seed.itemIds.agua, qty: 0 }])).status).toBe(400);
    expect((await post([{ itemId: env.seed.itemIds.agua, qty: 21 }])).status).toBe(400);
    expect((await post([{ itemId: "no-es-uuid", qty: 1 }])).status).toBe(400);
    const missing = await post([{ itemId: "00000000-0000-4000-8000-000000000000", qty: 1 }]);
    expect(missing.status).toBe(422);
    expect(missing.body.error).toBe("item_not_found");
  });

  it("un plato agotado no se puede pedir y vuelve al reponerlo", async () => {
    const guest = await joinTable(env.api, env.seed.tableTokens["6"]!, uid("dev"));
    const itemId = env.seed.itemIds.croquetas!;
    const off = await env.api.patch(`/staff/items/${itemId}/availability`, { available: false }, kitchen);
    expect(off.status).toBe(200);

    const menu = await env.api.get(`/public/q/${env.seed.tableTokens["6"]}`);
    const item = menu.body.menu.categories.flatMap((c: any) => c.items).find((i: any) => i.id === itemId);
    expect(item.available).toBe(false);

    const blocked = await env.api.post("/public/orders", { idempotencyKey: uid("order"), items: [{ itemId, qty: 1 }] }, guest.body.token);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toBe("item_unavailable");

    await env.api.patch(`/staff/items/${itemId}/availability`, { available: true }, kitchen);
    const ok = await env.api.post("/public/orders", { idempotencyKey: uid("order"), items: [{ itemId, qty: 1 }] }, guest.body.token);
    expect(ok.status).toBe(201);
  });

  it("el camarero pide en nombre de un comensal y de la mesa", async () => {
    const qr = env.seed.tableTokens["T1"]!;
    const guest = await joinTable(env.api, qr, uid("dev"));
    const sessionId = guest.body.sessionId;

    const forGuest = await env.api.post(
      `/staff/sessions/${sessionId}/orders`,
      { guestId: guest.body.guest.id, items: [{ itemId: env.seed.itemIds.pasta, qty: 1 }] },
      waiter,
    );
    expect(forGuest.status).toBe(201);
    const forTable = await env.api.post(
      `/staff/sessions/${sessionId}/orders`,
      { items: [{ itemId: env.seed.itemIds.agua, qty: 2 }] },
      waiter,
    );
    expect(forTable.status).toBe(201);

    const detail = await env.api.get(`/staff/sessions/${sessionId}`, waiter);
    expect(detail.body.orders.map((o: any) => o.source)).toEqual(["waiter", "waiter"]);
    expect(detail.body.orders[0].guestAlias).toBe("Comensal 1");
    expect(detail.body.orders[1].guestAlias).toBeNull();

    // Un comensal inventado no vale
    const bad = await env.api.post(
      `/staff/sessions/${sessionId}/orders`,
      { guestId: "00000000-0000-4000-8000-000000000000", items: [{ itemId: env.seed.itemIds.agua, qty: 1 }] },
      waiter,
    );
    expect(bad.status).toBe(404);
  });

  it("el camarero abre una mesa sin que ningún comensal escanee", async () => {
    const open = await env.api.post(`/staff/tables/${env.seed.tableIds["T2"]}/session`, undefined, waiter);
    expect(open.status).toBe(201);
    const again = await env.api.post(`/staff/tables/${env.seed.tableIds["T2"]}/session`, undefined, waiter);
    expect(again.status).toBe(200);
    expect(again.body.sessionId).toBe(open.body.sessionId);
    const tables = await env.api.get("/staff/tables", waiter);
    expect(tables.body.find((t: any) => t.label === "T2").status).toBe("occupied");
  });
});

describe("cuenta", () => {
  it("no genera cuenta sin consumo y exige regenerarla si se pide algo después", async () => {
    const qr = env.seed.tableTokens["T3"]!;
    const guest = await joinTable(env.api, qr, uid("dev"));
    const sid = guest.body.sessionId;
    const empty = await env.api.post(`/staff/sessions/${sid}/bill`, {}, waiter);
    expect(empty.status).toBe(409);
    expect(empty.body.error).toBe("nothing_to_bill");

    const order = (itemId: string) =>
      env.api.post("/public/orders", { idempotencyKey: uid("order"), items: [{ itemId, qty: 1 }] }, guest.body.token);
    await order(env.seed.itemIds.agua!);
    const bill = await env.api.post(`/staff/sessions/${sid}/bill`, {}, waiter);
    expect(bill.body.totalCents).toBe(200);

    await order(env.seed.itemIds.cafe!);
    const stale = await env.api.post(`/staff/bills/${bill.body.id}/payments`, { method: "cash", amountCents: 200 }, waiter);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("bill_outdated");

    const fresh = await env.api.post(`/staff/sessions/${sid}/bill`, {}, waiter);
    expect(fresh.body.id).toBe(bill.body.id); // se recalcula la misma cuenta
    expect(fresh.body.totalCents).toBe(360);
  });

  it("solo el encargado puede aplicar descuentos", async () => {
    const guest = await joinTable(env.api, env.seed.tableTokens["1"]!, uid("dev"));
    const sid = guest.body.sessionId;
    await env.api.post("/public/orders", { idempotencyKey: uid("order"), items: [{ itemId: env.seed.itemIds.paella, qty: 1 }] }, guest.body.token);

    const byWaiter = await env.api.post(`/staff/sessions/${sid}/bill`, { discountCents: 100 }, waiter);
    expect(byWaiter.status).toBe(403);
    const byManager = await env.api.post(`/staff/sessions/${sid}/bill`, { discountCents: 100 }, manager);
    expect(byManager.status).toBe(201);
    expect(byManager.body.totalCents).toBe(1300);
    const tooBig = await env.api.post(`/staff/sessions/${sid}/bill`, { discountCents: 99999 }, manager);
    expect(tooBig.status).toBe(422);
  });
});

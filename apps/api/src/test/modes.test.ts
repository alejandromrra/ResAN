import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinTable, loginPin, loginStaff, setupEnv, uid, type TestEnv } from "./helpers";

describe("modo solo carta", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv({ orderMode: "view_only" });
  });
  afterAll(async () => env.close());

  it("permite entrar para llamar al camarero pero no pedir", async () => {
    const guest = await joinTable(env.api, env.seed.tableTokens["1"]!, uid("dev"));
    expect(guest.status).toBe(200);
    const order = await env.api.post(
      "/public/orders",
      { idempotencyKey: uid("order"), items: [{ itemId: env.seed.itemIds.agua, qty: 1 }] },
      guest.body.token,
    );
    expect(order.status).toBe(403);
    expect(order.body.error).toBe("view_only");
    const call = await env.api.post("/public/calls", { type: "waiter" }, guest.body.token);
    expect(call.status).toBe(201);
  });
});

describe("liberar una mesa", () => {
  let env: TestEnv;
  let waiter: string;
  let manager: string;
  beforeAll(async () => {
    env = await setupEnv();
    waiter = await loginPin(env.api, "demo", "1111");
    manager = await loginStaff(env.api, env.seed.credentials.manager.email, env.seed.credentials.manager.password);
  });
  afterAll(async () => env.close());

  it("el camarero cierra una mesa sin consumo, pero no una con consumo", async () => {
    const empty = await joinTable(env.api, env.seed.tableTokens["1"]!, uid("dev"));
    const ok = await env.api.post(`/staff/sessions/${empty.body.sessionId}/close`, {}, waiter);
    expect(ok.status).toBe(200);

    const busy = await joinTable(env.api, env.seed.tableTokens["2"]!, uid("dev"));
    await env.api.post(
      "/public/orders",
      { idempotencyKey: uid("order"), items: [{ itemId: env.seed.itemIds.agua, qty: 1 }] },
      busy.body.token,
    );
    const denied = await env.api.post(`/staff/sessions/${busy.body.sessionId}/close`, {}, waiter);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("session_has_consumption");
    const forced = await env.api.post(`/staff/sessions/${busy.body.sessionId}/close`, { reason: "error" }, manager);
    expect(forced.status).toBe(200);
  });
});

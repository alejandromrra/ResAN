import type { FastifyInstance } from "fastify";
import type { HTTPMethods } from "fastify";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { createDb } from "../db";
import { seedDemo, type SeedOptions, type SeedResult } from "../db/seed";
import type { Ctx } from "../context";

export interface TestEnv {
  app: FastifyInstance;
  ctx: Ctx;
  seed: SeedResult;
  close: () => Promise<void>;
  api: Api;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface Api {
  call<T = any>(
    method: HTTPMethods,
    url: string,
    opts?: { token?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<ApiResponse<T>>;
  get<T = any>(url: string, token?: string): Promise<ApiResponse<T>>;
  post<T = any>(url: string, body?: unknown, token?: string): Promise<ApiResponse<T>>;
  patch<T = any>(url: string, body?: unknown, token?: string): Promise<ApiResponse<T>>;
  del<T = any>(url: string, token?: string): Promise<ApiResponse<T>>;
}

export function makeApi(app: FastifyInstance): Api {
  const call: Api["call"] = async (method, url, opts = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
      payload: opts.body as object | undefined,
    });
    let body: any = null;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body };
  };
  return {
    call,
    get: (url, token) => call("GET", url, { token }),
    post: (url, body, token) => call("POST", url, { body, token }),
    patch: (url, body, token) => call("PATCH", url, { body, token }),
    del: (url, token) => call("DELETE", url, { token }),
  };
}

export async function setupEnv(opts: SeedOptions = {}): Promise<TestEnv> {
  const handle = await createDb();
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "t".repeat(40) });
  const { app, ctx } = await buildApp({ db: handle.db, config });
  const seed = await seedDemo(handle.db, opts);
  if (!seed) throw new Error("seed no creó el local");
  await app.ready();
  return {
    app,
    ctx,
    seed,
    api: makeApi(app),
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export async function loginStaff(api: Api, email: string, password: string, venueSlug?: string): Promise<string> {
  const res = await api.post("/auth/login", { email, password, venueSlug });
  if (res.status !== 200) throw new Error(`login falló (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export async function loginPin(api: Api, venueSlug: string, pin: string): Promise<string> {
  const res = await api.post("/auth/pin", { venueSlug, pin });
  if (res.status !== 200) throw new Error(`pin falló (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export async function joinTable(
  api: Api,
  qrToken: string,
  deviceId: string,
  extra: { alias?: string; language?: string } = {},
) {
  return api.post(`/public/q/${qrToken}/join`, { deviceId, ...extra });
}

let counter = 0;
export const uid = (prefix = "k") => `${prefix}-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

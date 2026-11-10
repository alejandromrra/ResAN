import type { Config } from "./config";
import type { Db } from "./db";
import type { EventBus } from "./realtime/bus";

export interface Ctx {
  db: Db;
  bus: EventBus;
  config: Config;
}

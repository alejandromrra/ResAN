import type { Db } from "../db";
import { auditLog } from "../db/schema";

export async function audit(
  db: Db,
  entry: {
    venueId: string;
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string;
    data?: unknown;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    venueId: entry.venueId,
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    data: entry.data ?? null,
  });
}

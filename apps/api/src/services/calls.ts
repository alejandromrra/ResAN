import { and, eq } from "drizzle-orm";
import type { CallType } from "@resan/shared";
import type { Ctx } from "../context";
import { serviceCalls, tableSessions } from "../db/schema";
import { conflict, gone, notFound } from "../lib/errors";

export async function createCall(
  ctx: Ctx,
  args: { venueId: string; sessionId: string; type: CallType },
): Promise<{ id: string; duplicate: boolean }> {
  const out = await ctx.db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(tableSessions)
      .where(and(eq(tableSessions.id, args.sessionId), eq(tableSessions.venueId, args.venueId)))
      .for("update");
    if (!session) throw notFound("session_not_found");
    if (session.status === "closed") throw gone("session_closed");

    // Un solo aviso abierto por tipo y mesa: pulsar varias veces no satura al personal
    const [open] = await tx
      .select()
      .from(serviceCalls)
      .where(
        and(
          eq(serviceCalls.sessionId, session.id),
          eq(serviceCalls.type, args.type),
          eq(serviceCalls.status, "open"),
        ),
      );
    if (open) return { id: open.id, duplicate: true };

    const [call] = await tx
      .insert(serviceCalls)
      .values({ venueId: args.venueId, sessionId: session.id, type: args.type })
      .returning();
    if (args.type === "bill") {
      await tx.update(tableSessions).set({ status: "bill_requested" }).where(eq(tableSessions.id, session.id));
    }
    return { id: call!.id, duplicate: false };
  });
  if (!out.duplicate) ctx.bus.publish(args.venueId, { type: "call.created", sessionId: args.sessionId });
  return out;
}

export async function updateCall(
  ctx: Ctx,
  args: { venueId: string; callId: string; userId: string; to: "ack" | "done" },
): Promise<void> {
  const sessionId = await ctx.db.transaction(async (tx) => {
    const [call] = await tx
      .select()
      .from(serviceCalls)
      .where(and(eq(serviceCalls.id, args.callId), eq(serviceCalls.venueId, args.venueId)))
      .for("update");
    if (!call) throw notFound("call_not_found");
    if (call.status === "done" && args.to === "ack") throw conflict("call_already_done");
    if (call.status === args.to) return call.sessionId;

    const now = new Date();
    // La primera respuesta (ir o resolver) cuenta como tiempo de respuesta de quien la dio
    await tx
      .update(serviceCalls)
      .set({
        status: args.to,
        ...(call.ackAt ? {} : { ackBy: args.userId, ackAt: now }),
        ...(args.to === "done" ? { doneBy: args.userId, doneAt: now } : {}),
      })
      .where(eq(serviceCalls.id, call.id));

    if (args.to === "done" && call.type === "bill") {
      await tx
        .update(tableSessions)
        .set({ status: "open" })
        .where(and(eq(tableSessions.id, call.sessionId), eq(tableSessions.status, "bill_requested")));
    }
    return call.sessionId;
  });
  ctx.bus.publish(args.venueId, { type: "call.updated", sessionId });
}

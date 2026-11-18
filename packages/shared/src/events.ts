export const EVENT_TYPES = [
  "order.created",
  "order.updated",
  "item.status",
  "call.created",
  "call.updated",
  "session.updated",
  "menu.updated",
  "table.updated",
  "assignment.updated",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Los eventos son ligeros a propósito: avisan de que algo cambió y el cliente
 * recarga el estado que le interesa. Así no se filtran datos por el canal y la
 * reconexión es trivial (si faltan eventos, se recarga todo).
 */
export interface RealtimeEvent {
  seq: number;
  type: EventType;
  venueId: string;
  sessionId?: string;
  tableId?: string;
  at: string;
}

export type ClientMessage = { type: "auth"; token: string; since?: number };

export type ServerMessage =
  | { type: "ready"; seq: number }
  | { type: "event"; event: RealtimeEvent }
  | { type: "resync"; seq: number }
  | { type: "error"; code: string };

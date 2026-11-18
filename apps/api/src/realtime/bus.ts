import type { EventType, RealtimeEvent } from "@resan/shared";

const BUFFER_SIZE = 200;

export interface PublishInput {
  type: EventType;
  sessionId?: string;
  tableId?: string;
}

/**
 * Bus de eventos en memoria con buffer por local para reenviar lo perdido al
 * reconectar. Con varias instancias del servidor hay que sustituirlo por una
 * implementación sobre Redis pub/sub con la misma interfaz.
 */
export class EventBus {
  private seq = new Map<string, number>();
  private buffers = new Map<string, RealtimeEvent[]>();
  private listeners = new Set<(event: RealtimeEvent) => void>();
  /** Personal conectado por local (usuario → nº de pantallas abiertas). */
  private presence = new Map<string, Map<string, number>>();

  join(venueId: string, userId: string) {
    const m = this.presence.get(venueId) ?? new Map<string, number>();
    m.set(userId, (m.get(userId) ?? 0) + 1);
    this.presence.set(venueId, m);
  }

  leave(venueId: string, userId: string) {
    const m = this.presence.get(venueId);
    if (!m) return;
    const n = (m.get(userId) ?? 1) - 1;
    if (n <= 0) m.delete(userId);
    else m.set(userId, n);
  }

  online(venueId: string): Set<string> {
    return new Set(this.presence.get(venueId)?.keys() ?? []);
  }

  publish(venueId: string, input: PublishInput): RealtimeEvent {
    const seq = (this.seq.get(venueId) ?? 0) + 1;
    this.seq.set(venueId, seq);
    const event: RealtimeEvent = {
      seq,
      type: input.type,
      venueId,
      sessionId: input.sessionId,
      tableId: input.tableId,
      at: new Date().toISOString(),
    };
    const buf = this.buffers.get(venueId) ?? [];
    buf.push(event);
    if (buf.length > BUFFER_SIZE) buf.shift();
    this.buffers.set(venueId, buf);
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // un oyente roto no debe frenar al resto
      }
    }
    return event;
  }

  subscribe(fn: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  currentSeq(venueId: string): number {
    return this.seq.get(venueId) ?? 0;
  }

  /**
   * Eventos posteriores a `since`. Devuelve null cuando no se pueden
   * garantizar (buffer desbordado o servidor reiniciado): el cliente debe recargar todo.
   */
  since(venueId: string, since: number): RealtimeEvent[] | null {
    const current = this.currentSeq(venueId);
    if (since > current) return null;
    if (since === current) return [];
    const buf = this.buffers.get(venueId) ?? [];
    const oldest = buf[0]?.seq ?? current + 1;
    if (since < oldest - 1) return null;
    return buf.filter((e) => e.seq > since);
  }
}

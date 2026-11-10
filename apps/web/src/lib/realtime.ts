"use client";
import { useEffect, useRef } from "react";
import type { ServerMessage } from "@resan/shared";
import { API_URL } from "./api";

/**
 * Mantiene un WebSocket con reconexión. Cada evento (o un "resync" tras reconectar)
 * dispara `onChange`, que debe recargar el estado: los eventos solo avisan.
 */
export function useRealtime(token: string | null, onChange: (ev?: { type: string }) => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let lastSeq: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      ws = new WebSocket(API_URL.replace(/^http/, "ws") + "/ws");
      ws.onopen = () => ws!.send(JSON.stringify({ type: "auth", token, since: lastSeq }));
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data as string) as ServerMessage;
        if (msg.type === "ready") {
          retry = 0;
          if (lastSeq === undefined) lastSeq = msg.seq;
          else cb.current({ type: "reconnected" });
        } else if (msg.type === "event") {
          lastSeq = msg.event.seq;
          cb.current(msg.event);
        } else if (msg.type === "resync") {
          lastSeq = msg.seq;
          cb.current({ type: "resync" });
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    // Si la pestaña vuelve al primer plano, recarga por si el móvil durmió el socket
    const onVisible = () => document.visibilityState === "visible" && cb.current({ type: "visible" });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [token]);
}

"use client";
import { useCallback, useEffect, useState } from "react";

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Los navegadores solo dejan sonar tras un gesto del usuario (un toque o una tecla). */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume().then(notify);
  } catch {
    /* sin audio */
  }
}
const audioReady = () => !!ctx && ctx.state === "running";

export function beep(kind: "ready" | "call" | "bill" = "ready") {
  if (!ctx || ctx.state !== "running") return;
  const notes = kind === "ready" ? [880, 1175] : kind === "call" ? [660, 660, 660] : [523, 659, 784];
  notes.forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.frequency.value = f;
    o.connect(g);
    g.connect(ctx!.destination);
    const t = ctx!.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.start(t);
    o.stop(t + 0.16);
  });
}

async function requestWakeLock(): Promise<{ release(): Promise<void> } | undefined> {
  try {
    return await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen");
  } catch {
    return undefined;
  }
}

const SHIFT_KEY = "resan.staff.shift";
function readShift() {
  try {
    return sessionStorage.getItem(SHIFT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Turno del personal: se inicia una vez por sesión del navegador (sirve para sala y cocina).
 * Tras recargar la página el navegador vuelve a bloquear el sonido; se reactiva solo con
 * el primer toque en cualquier parte de la pantalla.
 */
export function useShift() {
  const [started, setStarted] = useState<boolean | null>(null);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    setStarted(readShift());
    const update = () => setSoundOn(audioReady());
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, []);

  // Reactiva el sonido con cualquier gesto
  useEffect(() => {
    if (!started) return;
    const onGesture = () => unlockAudio();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [started]);

  // Pantalla siempre encendida mientras dura el turno (se pide de nuevo al volver a la pestaña)
  useEffect(() => {
    if (!started) return;
    let lock: { release(): Promise<void> } | undefined;
    const acquire = async () => {
      if (document.visibilityState === "visible") lock = await requestWakeLock();
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, [started]);

  const start = useCallback(() => {
    unlockAudio();
    try {
      sessionStorage.setItem(SHIFT_KEY, "1");
    } catch {
      /* modo privado */
    }
    setStarted(true);
    beep("ready");
  }, []);

  return { started, soundOn, start };
}

export function endShift() {
  try {
    sessionStorage.removeItem(SHIFT_KEY);
  } catch {
    /* modo privado */
  }
}

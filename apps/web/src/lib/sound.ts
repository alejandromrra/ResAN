"use client";

let ctx: AudioContext | null = null;

/** Los navegadores solo dejan sonar tras un gesto del usuario: se llama desde "Iniciar turno". */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    /* sin audio */
  }
}

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

export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen");
    return () => void lock?.release();
  } catch {
    return () => {};
  }
}

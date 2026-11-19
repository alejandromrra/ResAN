"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DELAY_LABEL, type AdminCategoryDTO, type DelayDTO, type KitchenTicketDTO } from "@resan/shared";
import { Flame, PackageX, StickyNote, Timer } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { beep, useAlerts } from "@/lib/sound";
import { useStaff } from "@/lib/staff-auth";
import { ErrorBanner, Sheet, cx } from "@/components/ui";
import { SoundHint, StaffShell } from "../StaffShell";
import { ShiftBar, ShiftGate } from "../shift";

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

/** Minutos y segundos que faltan (o «ya») hasta `iso`. */
function countdown(iso: string | null, now: number) {
  if (!iso) return "—";
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return "ya";
  return s >= 60 ? `${Math.ceil(s / 60)}′` : `${s}″`;
}

const COLS = [
  { key: "preparing", title: "Al fuego", accent: "bg-amber-400", ring: "ring-amber-400/30", text: "text-amber-300" },
  { key: "ready", title: "Listos · los recoge sala", accent: "bg-emerald-400", ring: "ring-emerald-400/30", text: "text-emerald-300" },
] as const;

function Kitchen() {
  const { token, can, me } = useStaff();
  const [tickets, setTickets] = useState<KitchenTicketDTO[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const { soundOn } = useAlerts();
  const [error, setError] = useState<string | null>(null);
  const [stock, setStock] = useState<AdminCategoryDTO[] | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const [delays, setDelays] = useState<DelayDTO[]>([]);
  const knownDelays = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([
        api<KitchenTicketDTO[]>("/staff/kitchen", { token }),
        api<DelayDTO[]>("/staff/delays?audience=kitchen", { token }),
      ]);
      const delayKeys = new Set(d.map((x) => `${x.kind}:${x.itemId}`));
      if (knownDelays.current && [...delayKeys].some((k) => !knownDelays.current!.has(k))) beep("call");
      knownDelays.current = delayKeys;
      setDelays(d);
      const ids = new Set(t.map((x) => x.orderId));
      // Suena cuando entra un ticket nuevo (no en la primera carga)
      if (known.current) {
        const added = [...ids].filter((i) => !known.current!.has(i));
        if (added.length) {
          beep("ready");
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 4000);
        }
      }
      known.current = ids;
      setTickets(t);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const i = setInterval(() => setNow(Date.now()), 1_000);
    // Los retrasos dependen del reloj: se recalculan aunque no haya eventos
    const j = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(i);
      clearInterval(j);
    };
  }, [load]);
  useRealtime(token, () => void load());


  const setStatus = async (ids: string[], status: string) => {
    try {
      await api("/staff/order-items/status", { method: "PATCH", body: { ids, status }, token });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const loadStock = async () => setStock(await api<AdminCategoryDTO[]>("/staff/menu", { token }));
  const openStock = async () => {
    setStockOpen(true);
    await loadStock();
  };
  const toggle = async (id: string, available: boolean) => {
    setStock((s) => s?.map((c) => ({ ...c, items: c.items.map((i) => (i.id === id ? { ...i, available } : i)) })) ?? s);
    try {
      await api(`/staff/items/${id}/availability`, { method: "PATCH", body: { available }, token });
    } finally {
      await loadStock();
    }
  };


  const totalPrep = tickets.reduce((n, t) => n + t.items.filter((i) => i.status !== "ready").reduce((a, i) => a + i.qty, 0), 0);
  const totalReady = tickets.reduce((n, t) => n + t.items.filter((i) => i.status === "ready").reduce((a, i) => a + i.qty, 0), 0);

  return (
    <div className="mx-auto max-w-[1600px] p-4">
      <SoundHint on={soundOn} />
      <ShiftBar dark />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold">Comandas</h1>
        <div className="flex gap-2 text-sm">
          <span className="rounded-full bg-amber-400/15 px-3 py-1 font-semibold text-amber-300">{totalPrep} al fuego</span>
          <span className="rounded-full bg-emerald-400/15 px-3 py-1 font-semibold text-emerald-300">{totalReady} listos</span>
        </div>
        {can("item.availability") && (
          <button className="btn ml-auto bg-white/10 text-white hover:bg-white/15" onClick={openStock}><PackageX className="size-4" /> Agotados</button>
        )}
      </div>
      {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
      {delays.length > 0 && (
        <div className="mb-4 animate-fade-up rounded-3xl bg-red-500/10 p-3 ring-1 ring-red-500/40">
          <div className="mb-2 flex items-center gap-2 px-1 text-sm font-bold text-red-300">
            <Flame className="size-4" /> {delays.length} {delays.length === 1 ? "retraso" : "retrasos"} en cocina
          </div>
          <div className="flex flex-wrap gap-2">
            {delays.map((d) => (
              <span key={`${d.kind}:${d.itemId}`} className="flex items-center gap-2 rounded-2xl bg-stone-900 px-3 py-2 text-sm ring-1 ring-red-500/40">
                <b className="font-display text-base">Mesa {d.tableLabel}</b>
                <span className="text-white/80">{d.qty}× {d.itemName}</span>
                <span className="text-xs text-red-300">{DELAY_LABEL[d.kind]}</span>
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold tabular-nums">{d.minutes}′</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mb-3 text-sm text-white/40">Los platos avanzan solos según su tiempo de cocina. {can("kitchen.update") && "Si algo sale antes, toca el plato para marcarlo listo."}</p>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {COLS.map((col) => {
          const list = tickets
            .map((t) => ({ ...t, items: t.items.filter((i) => (col.key === "ready" ? i.status === "ready" : i.status !== "ready")) }))
            .filter((t) => t.items.length > 0);
          return (
            <section key={col.key} className="flex min-h-[60dvh] flex-col rounded-3xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <h2 className="mb-3 flex items-center gap-2 px-1 font-semibold">
                <span className={cx("size-2.5 rounded-full", col.accent)} />
                {col.title}
                <span className="ml-auto rounded-full bg-white/10 px-2.5 text-sm tabular-nums">{list.length}</span>
              </h2>
              <div className={cx("grid gap-3", col.key === "preparing" ? "md:grid-cols-2" : "")}>
                {list.length === 0 && <p className="py-10 text-center text-sm text-white/30 md:col-span-2">Sin comandas</p>}
                {list.map((t) => (
                  <article
                    key={t.orderId}
                    className={cx(
                      "animate-scale-in self-start overflow-hidden rounded-2xl bg-stone-900 ring-1 transition",
                      col.ring,
                      fresh.has(t.orderId) && col.key === "preparing" && "ring-2 ring-amber-400 shadow-[0_0_40px_-8px_rgb(251_191_36/.6)]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 px-4 pt-3">
                      <div>
                        <div className="font-display text-2xl leading-none font-semibold">Mesa {t.tableLabel}</div>
                        <div className="mt-1 text-xs text-white/40">Ronda {t.round} · hace {minutesSince(t.createdAt, now)}′</div>
                      </div>
                    </div>
                    <ul className="space-y-2 px-3 py-3">
                      {t.items.map((i) => {
                        const total = i.startedAt && i.dueAt ? new Date(i.dueAt).getTime() - new Date(i.startedAt).getTime() : 0;
                        const pct = total > 0 ? Math.min(100, ((now - new Date(i.startedAt!).getTime()) / total) * 100) : 0;
                        const tap = can("kitchen.update") && i.status === "preparing";
                        return (
                          <li key={i.id}>
                            <button
                              disabled={!tap}
                              onClick={() => tap && setStatus([i.id], "ready")}
                              className={cx("w-full rounded-xl bg-white/[0.04] px-3 py-2.5 text-left transition", tap && "active:scale-[.98] hover:bg-white/[0.07]")}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 text-lg leading-tight font-semibold">
                                  <span className={cx("mr-1.5 tabular-nums", col.text)}>{i.qty}×</span>{i.name}
                                </div>
                                {i.status === "ready" ? (
                                  <span className="shrink-0 rounded-full bg-emerald-500/20 px-2.5 py-1 text-sm font-bold text-emerald-300 tabular-nums">{i.readyAt ? `${minutesSince(i.readyAt, now)}′` : "✓"}</span>
                                ) : (
                                  <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums", pct >= 100 ? "bg-emerald-500 text-white" : pct > 75 ? "bg-amber-400 text-ink" : "bg-white/10 text-white/80")}>
                                    <Timer className="mr-1 inline size-3.5" />{countdown(i.dueAt, now)}
                                  </span>
                                )}
                              </div>
                              {i.note && (
                                <div className="mt-1 inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2 py-0.5 text-sm font-semibold text-red-300">
                                  <StickyNote className="size-3.5" /> {i.note}
                                </div>
                              )}
                              {i.status !== "ready" && (
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <div className={cx("h-full rounded-full transition-all duration-1000", pct > 75 ? "bg-amber-400" : "bg-sky-400")} style={{ width: `${pct}%` }} />
                                </div>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Sheet open={stockOpen} onClose={() => setStockOpen(false)} title="Disponibilidad" wide>
        <div className="space-y-4 px-5 pt-1 pb-6">
          <p className="text-sm text-stone-500">Toca un plato para marcarlo agotado. Desaparece al instante de la carta de los móviles.</p>
          {!stock && <div className="skeleton h-32" />}
          {stock?.map((c) => (
            <div key={c.id}>
              <div className="label">{c.translations[me.defaultLanguage]?.name}</div>
              <div className="flex flex-wrap gap-2">
                {c.items.filter((i) => i.active).map((i) => (
                  <button
                    key={i.id}
                    onClick={() => toggle(i.id, !i.available)}
                    className={cx(
                      "rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 transition active:scale-95",
                      i.available ? "bg-white text-ink ring-stone-200 hover:ring-stone-300" : "bg-red-50 text-red-700 line-through ring-red-200",
                    )}
                  >
                    {i.translations[me.defaultLanguage]?.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

export default function KitchenPage() {
  return (
    <StaffShell dark>
      <ShiftGate dark>
        <Kitchen />
      </ShiftGate>
    </StaffShell>
  );
}

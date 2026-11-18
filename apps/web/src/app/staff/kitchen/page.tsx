"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DELAY_LABEL, type AdminCategoryDTO, type DelayDTO, type KitchenTicketDTO } from "@resan/shared";
import { ArrowLeft, ChefHat, Flame, PackageX, StickyNote, Timer, CheckCheck } from "lucide-react";
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
const LATE = 15;

const COLS = [
  { key: "new", title: "Nuevos", next: "preparing", nextLabel: "Empezar", accent: "bg-amber-400", ring: "ring-amber-400/30", text: "text-amber-300" },
  { key: "preparing", title: "En preparación", next: "ready", nextLabel: "Listo", accent: "bg-sky-400", ring: "ring-sky-400/30", text: "text-sky-300" },
  { key: "ready", title: "Listos · esperan sala", next: null, nextLabel: "", accent: "bg-emerald-400", ring: "ring-emerald-400/30", text: "text-emerald-300" },
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
    const i = setInterval(() => setNow(Date.now()), 30_000);
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


  const totalNew = tickets.reduce((n, t) => n + t.items.filter((i) => i.status === "new").reduce((a, i) => a + i.qty, 0), 0);
  const totalPrep = tickets.reduce((n, t) => n + t.items.filter((i) => i.status === "preparing").reduce((a, i) => a + i.qty, 0), 0);
  const late = tickets.filter((t) => minutesSince(t.createdAt, now) >= LATE && t.items.some((i) => i.status !== "ready")).length;

  return (
    <div className="mx-auto max-w-[1600px] p-4">
      <SoundHint on={soundOn} />
      <ShiftBar dark />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold">Comandas</h1>
        <div className="flex gap-2 text-sm">
          <span className="rounded-full bg-amber-400/15 px-3 py-1 font-semibold text-amber-300">{totalNew} por empezar</span>
          <span className="rounded-full bg-sky-400/15 px-3 py-1 font-semibold text-sky-300">{totalPrep} al fuego</span>
          {late > 0 && <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-3 py-1 font-semibold text-red-300"><Flame className="size-4" /> {late} con retraso</span>}
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

      <div className="grid gap-4 lg:grid-cols-3">
        {COLS.map((col) => {
          const list = tickets
            .map((t) => ({ ...t, items: t.items.filter((i) => i.status === col.key) }))
            .filter((t) => t.items.length > 0);
          return (
            <section key={col.key} className="flex min-h-[60dvh] flex-col rounded-3xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <h2 className="mb-3 flex items-center gap-2 px-1 font-semibold">
                <span className={cx("size-2.5 rounded-full", col.accent)} />
                {col.title}
                <span className="ml-auto rounded-full bg-white/10 px-2.5 text-sm tabular-nums">{list.length}</span>
              </h2>
              <div className="space-y-3">
                {list.length === 0 && <p className="py-10 text-center text-sm text-white/30">Sin comandas</p>}
                {list.map((t) => {
                  const mins = minutesSince(t.createdAt, now);
                  const isLate = mins >= LATE && col.key !== "ready";
                  const pct = Math.min(100, (mins / LATE) * 100);
                  return (
                    <article
                      key={t.orderId}
                      className={cx(
                        "animate-scale-in overflow-hidden rounded-2xl bg-stone-900 ring-1 transition",
                        isLate ? "ring-red-500/60" : col.ring,
                        fresh.has(t.orderId) && col.key === "new" && "ring-2 ring-amber-400 shadow-[0_0_40px_-8px_rgb(251_191_36/.6)]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 px-4 pt-3">
                        <div>
                          <div className="font-display text-2xl leading-none font-semibold">Mesa {t.tableLabel}</div>
                          <div className="mt-1 text-xs text-white/40">Ronda {t.round}</div>
                        </div>
                        <span className={cx("flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums", isLate ? "animate-pulse bg-red-500 text-white" : "bg-white/10 text-white/80")}>
                          <Timer className="size-4" /> {mins}′
                        </span>
                      </div>
                      {col.key !== "ready" && (
                        <div className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                          <div className={cx("h-full rounded-full transition-all duration-1000", isLate ? "bg-red-500" : pct > 66 ? "bg-amber-400" : "bg-emerald-400")} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      <ul className="divide-y divide-white/5 px-4 py-2">
                        {t.items.map((i) => (
                          <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <div className="text-lg leading-tight font-semibold">
                                <span className={cx("mr-1.5 tabular-nums", col.text)}>{i.qty}×</span>{i.name}
                              </div>
                              {i.note && (
                                <div className="mt-1 inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2 py-0.5 text-sm font-semibold text-red-300">
                                  <StickyNote className="size-3.5" /> {i.note}
                                </div>
                              )}
                            </div>
                            {can("kitchen.update") && col.next && (
                              <button className={cx("btn shrink-0", col.key === "new" ? "bg-amber-400 text-ink hover:bg-amber-300" : "bg-emerald-500 text-white hover:bg-emerald-400")} onClick={() => setStatus([i.id], col.next)}>
                                {col.nextLabel}
                              </button>
                            )}
                            {can("kitchen.update") && col.key === "ready" && (
                              <button className="btn-icon shrink-0 text-white/50 hover:bg-white/10 hover:text-white" title="Volver a preparación" onClick={() => setStatus([i.id], "preparing")}>
                                <ArrowLeft className="size-5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {can("kitchen.update") && col.next && t.items.length > 1 && (
                        <button className="flex w-full items-center justify-center gap-2 border-t border-white/5 bg-white/[0.03] py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10" onClick={() => setStatus(t.items.map((i) => i.id), col.next)}>
                          <CheckCheck className="size-4" /> {col.nextLabel} toda la mesa
                        </button>
                      )}
                    </article>
                  );
                })}
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

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminCategoryDTO, KitchenTicketDTO } from "@resan/shared";
import { api, errorText } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { beep, keepAwake, unlockAudio } from "@/lib/sound";
import { useStaff } from "@/lib/staff-auth";
import { StaffShell } from "../StaffShell";

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

function Kitchen() {
  const { token, can, me } = useStaff();
  const [tickets, setTickets] = useState<KitchenTicketDTO[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stock, setStock] = useState<AdminCategoryDTO[] | null>(null);
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await api<KitchenTicketDTO[]>("/staff/kitchen", { token });
      const ids = new Set(t.map((x) => x.orderId));
      // Suena cuando entra un ticket nuevo (no en la primera carga)
      if (known.current && [...ids].some((i) => !known.current!.has(i))) beep("ready");
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
    return () => clearInterval(i);
  }, [load]);
  useRealtime(token, () => void load());

  useEffect(() => {
    if (!started) return;
    let release = () => {};
    void keepAwake().then((r) => (release = r));
    return () => release();
  }, [started]);

  const setStatus = async (ids: string[], status: string) => {
    try {
      await api("/staff/order-items/status", { method: "PATCH", body: { ids, status }, token });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const openStock = async () => {
    if (stock) return setStock(null);
    setStock(await api<AdminCategoryDTO[]>("/staff/menu", { token }));
  };
  const toggle = async (id: string, available: boolean) => {
    await api(`/staff/items/${id}/availability`, { method: "PATCH", body: { available }, token });
    setStock(await api<AdminCategoryDTO[]>("/staff/menu", { token }));
  };

  const cols = [
    { key: "new", title: "Nuevos", next: "preparing", nextLabel: "Empezar", color: "border-amber-400" },
    { key: "preparing", title: "En preparación", next: "ready", nextLabel: "Listo", color: "border-sky-400" },
    { key: "ready", title: "Listos (esperan al camarero)", next: null, nextLabel: "", color: "border-emerald-400" },
  ] as const;

  return (
    <div className="p-3">
      {!started && (
        <div className="mx-auto mt-10 max-w-sm card p-6 text-center">
          <h1 className="text-xl font-bold">Cocina</h1>
          <p className="mt-1 text-sm text-stone-600">Activa el sonido y mantén la pantalla encendida.</p>
          <button className="btn btn-primary mt-4 w-full" onClick={() => { unlockAudio(); setStarted(true); beep("ready"); }}>Iniciar turno</button>
        </div>
      )}
      {started && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <h1 className="text-lg font-bold">Pantalla de cocina</h1>
            {error && <span className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{error}</span>}
            {can("item.availability") && <button className="btn btn-ghost ml-auto !py-1.5" onClick={openStock}>Agotados</button>}
          </div>
          {stock && (
            <div className="card mb-3 max-h-72 overflow-y-auto p-3">
              {stock.map((c) => (
                <div key={c.id} className="mb-2">
                  <b className="text-sm">{c.translations[me.defaultLanguage]?.name}</b>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {c.items.filter((i) => i.active).map((i) => (
                      <button key={i.id} onClick={() => toggle(i.id, !i.available)} className={`chip !px-3 !py-1.5 !text-sm ${i.available ? "" : "!bg-red-100 !text-red-800 line-through"}`}>
                        {i.translations[me.defaultLanguage]?.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            {cols.map((col) => {
              const list = tickets
                .map((t) => ({ ...t, items: t.items.filter((i) => i.status === col.key) }))
                .filter((t) => t.items.length > 0);
              return (
                <section key={col.key} className="rounded-2xl bg-stone-100 p-2">
                  <h2 className="px-2 py-1 font-semibold">{col.title} <span className="text-stone-500">({list.length})</span></h2>
                  <div className="space-y-2">
                    {list.map((t) => {
                      const mins = minutesSince(t.createdAt, now);
                      return (
                        <article key={t.orderId} className={`card border-l-4 ${col.color} p-3 ${mins >= 15 && col.key !== "ready" ? "!bg-red-50" : ""}`}>
                          <div className="flex items-baseline justify-between">
                            <b className="text-lg">Mesa {t.tableLabel} <span className="text-sm font-normal text-stone-500">· ronda {t.round}</span></b>
                            <span className={`text-sm ${mins >= 15 ? "font-bold text-red-600" : "text-stone-500"}`}>{mins} min</span>
                          </div>
                          <ul className="mt-1 space-y-1.5">
                            {t.items.map((i) => (
                              <li key={i.id} className="flex items-start justify-between gap-2">
                                <div>
                                  <span className="font-semibold">{i.qty}× {i.name}</span>
                                  {i.note && <div className="text-sm font-medium text-red-700">⚠ {i.note}</div>}
                                </div>
                                {can("kitchen.update") && col.next && (
                                  <button className="btn btn-primary !px-3 !py-1.5" onClick={() => setStatus([i.id], col.next)}>{col.nextLabel}</button>
                                )}
                                {can("kitchen.update") && col.key === "ready" && (
                                  <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => setStatus([i.id], "preparing")}>Volver</button>
                                )}
                              </li>
                            ))}
                          </ul>
                          {can("kitchen.update") && col.next && t.items.length > 1 && (
                            <button className="btn btn-ghost mt-2 w-full !py-1.5" onClick={() => setStatus(t.items.map((i) => i.id), col.next)}>{col.nextLabel} todo</button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function KitchenPage() {
  return (
    <StaffShell>
      <Kitchen />
    </StaffShell>
  );
}

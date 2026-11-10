"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  allowedNextStatuses,
  formatMoney,
  type AdminCategoryDTO,
  type FloorTasksDTO,
  type ItemStatus,
  type StaffSessionDTO,
  type StaffTableDTO,
  type TableStatus,
} from "@resan/shared";
import { api, errorText } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { beep, keepAwake, unlockAudio } from "@/lib/sound";
import { useStaff } from "@/lib/staff-auth";
import { StaffShell } from "../StaffShell";

const STATUS_STYLE: Record<TableStatus, { label: string; cls: string }> = {
  free: { label: "Libre", cls: "bg-white text-stone-500" },
  occupied: { label: "Ocupada", cls: "bg-sky-100 text-sky-900" },
  waiting_food: { label: "Esperando", cls: "bg-amber-100 text-amber-900" },
  paying: { label: "Cobrando", cls: "bg-violet-100 text-violet-900" },
  ready_to_serve: { label: "¡Listo para servir!", cls: "bg-emerald-200 text-emerald-950" },
  pending_approval: { label: "Aprobar pedido", cls: "bg-orange-200 text-orange-950" },
  calling: { label: "Llama", cls: "bg-red-200 text-red-950" },
  bill_requested: { label: "Pide la cuenta", cls: "bg-red-300 text-red-950" },
};
const ITEM_LABEL: Record<ItemStatus, string> = {
  pending_approval: "Por aprobar", new: "Nuevo", preparing: "Cocinando", ready: "Listo", served: "Servido", cancelled: "Anulado",
};

function Floor() {
  const { token, me, can } = useStaff();
  const [tables, setTables] = useState<StaffTableDTO[]>([]);
  const [tasks, setTasks] = useState<FloorTasksDTO | null>(null);
  const [open, setOpen] = useState<string | null>(null); // tableId
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<{ ready: Set<string>; calls: Set<string>; appr: Set<string> } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, k] = await Promise.all([
        api<StaffTableDTO[]>("/staff/tables", { token }),
        api<FloorTasksDTO>("/staff/floor/tasks", { token }),
      ]);
      const cur = {
        ready: new Set(k.ready.map((r) => r.itemId)),
        calls: new Set(k.calls.filter((c) => c.status === "open").map((c) => c.id)),
        appr: new Set(k.approvals.map((a) => a.orderId)),
      };
      const p = prev.current;
      if (p) {
        const newCall = k.calls.find((c) => c.status === "open" && !p.calls.has(c.id));
        if (newCall) beep(newCall.type === "bill" ? "bill" : "call");
        else if ([...cur.ready].some((i) => !p.ready.has(i))) beep("ready");
        else if ([...cur.appr].some((i) => !p.appr.has(i))) beep("call");
      }
      prev.current = cur;
      setTables(t);
      setTasks(k);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [token]);

  useEffect(() => void load(), [load]);
  useRealtime(token, () => void load());
  useEffect(() => {
    if (!started) return;
    let release = () => {};
    void keepAwake().then((r) => (release = r));
    return () => release();
  }, [started]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!started) {
    return (
      <div className="mx-auto mt-10 max-w-sm card p-6 text-center">
        <h1 className="text-xl font-bold">Sala</h1>
        <p className="mt-1 text-sm text-stone-600">Activa los avisos sonoros (plato listo, llamadas y cuenta) y mantén la pantalla encendida.</p>
        <button className="btn btn-primary mt-4 w-full" onClick={() => { unlockAudio(); setStarted(true); beep("ready"); }}>Iniciar turno</button>
      </div>
    );
  }

  const zones = [...new Set(tables.map((t) => t.zoneName ?? "Sin zona"))];
  const urgent = tasks ? tasks.calls.filter((c) => c.status !== "done").length + tasks.approvals.length + tasks.ready.length : 0;

  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[1fr_22rem]">
      <div>
        {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {zones.map((z) => (
          <section key={z} className="mb-5">
            <h2 className="mb-2 font-semibold text-stone-700">{z}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {tables.filter((t) => (t.zoneName ?? "Sin zona") === z).map((t) => {
                const st = STATUS_STYLE[t.status];
                return (
                  <button key={t.id} onClick={() => setOpen(t.id)} className={`card p-3 text-left ${st.cls} ${t.status === "free" ? "" : "border-2 border-current/30"}`}>
                    <div className="flex items-baseline justify-between">
                      <b className="text-2xl">{t.label}</b>
                      {t.sessionId && <span className="text-xs">👥 {t.guestCount}</span>}
                    </div>
                    <div className="text-sm font-medium">{st.label}</div>
                    {t.sessionId && <div className="text-sm">{formatMoney(t.totalCents, me.defaultLanguage)}</div>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-16 lg:self-start">
        <h2 className="font-semibold">Tareas {urgent > 0 && <span className="chip !bg-red-100 !text-red-800">{urgent}</span>}</h2>
        {tasks && urgent === 0 && tasks.serve.length === 0 && <p className="text-sm text-stone-500">Todo al día.</p>}
        {tasks?.approvals.map((a) => (
          <div key={a.orderId} className="card flex items-center justify-between gap-2 border-l-4 border-orange-400 p-3">
            <div className="text-sm"><b>Mesa {a.tableLabel}</b><br />{a.itemCount} líneas por aprobar</div>
            <div className="flex gap-1">
              <button className="btn btn-ok !px-3 !py-1.5" onClick={() => act(() => api(`/staff/orders/${a.orderId}/approve`, { body: {}, token }))}>✓</button>
              <button className="btn btn-danger !px-3 !py-1.5" onClick={() => act(() => api(`/staff/orders/${a.orderId}/reject`, { body: {}, token }))}>✕</button>
            </div>
          </div>
        ))}
        {tasks?.calls.filter((c) => c.status !== "done").map((c) => (
          <div key={c.id} className="card flex items-center justify-between gap-2 border-l-4 border-red-400 p-3">
            <div className="text-sm"><b>Mesa {c.tableLabel}</b><br />{c.type === "bill" ? "🧾 Pide la cuenta" : "🙋 Llama al camarero"}{c.status === "ack" && " · atendiendo"}</div>
            <div className="flex gap-1">
              {c.status === "open" && <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => act(() => api(`/staff/calls/${c.id}/ack`, { body: {}, token }))}>Voy</button>}
              <button className="btn btn-ok !px-3 !py-1.5" onClick={() => act(() => api(`/staff/calls/${c.id}/done`, { body: {}, token }))}>Hecho</button>
            </div>
          </div>
        ))}
        {tasks?.ready.map((r) => (
          <div key={r.itemId} className="card flex items-center justify-between gap-2 border-l-4 border-emerald-500 bg-emerald-50 p-3">
            <div className="text-sm"><b>Mesa {r.tableLabel}</b> · listo en cocina<br />{r.qty}× {r.name}</div>
            <button className="btn btn-ok !px-3 !py-1.5" onClick={() => act(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [r.itemId], status: "served" }, token }))}>Servido</button>
          </div>
        ))}
        {tasks && tasks.serve.length > 0 && (
          <>
            <h3 className="pt-1 text-sm font-semibold text-stone-600">Bebidas y postres por llevar</h3>
            {tasks.serve.map((r) => (
              <div key={r.itemId} className="card flex items-center justify-between gap-2 p-3">
                <div className="text-sm"><b>Mesa {r.tableLabel}</b><br />{r.qty}× {r.name}</div>
                <button className="btn btn-ok !px-3 !py-1.5" onClick={() => act(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [r.itemId], status: "served" }, token }))}>Servido</button>
              </div>
            ))}
          </>
        )}
      </aside>

      {open && (
        <TableDrawer
          table={tables.find((t) => t.id === open)!}
          onClose={() => setOpen(null)}
          onChanged={load}
          canBill={can("bill.manage")}
        />
      )}
    </div>
  );
}

function TableDrawer({ table, onClose, onChanged, canBill }: { table: StaffTableDTO; onClose: () => void; onChanged: () => void; canBill: boolean }) {
  const { token, me, can } = useStaff();
  const [data, setData] = useState<StaffSessionDTO | null>(null);
  const [menu, setMenu] = useState<AdminCategoryDTO[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [guestId, setGuestId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState({ method: "card" as "card" | "cash" | "other", amount: "", tip: "" });
  const money = (c: number) => formatMoney(c, me.defaultLanguage);

  const reload = useCallback(async () => {
    if (!table.sessionId) return setData(null);
    try {
      setData(await api<StaffSessionDTO>(`/staff/sessions/${table.sessionId}`, { token }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [table.sessionId, token]);
  useEffect(() => void reload(), [reload, table.totalCents, table.status]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const openSession = () => run(async () => {
    await api(`/staff/tables/${table.id}/session`, { body: {}, token });
  });

  const startAdd = async () => {
    setAdding(true);
    if (!menu) setMenu(await api<AdminCategoryDTO[]>("/staff/menu", { token }));
  };
  const sendOrder = () => run(async () => {
    const items = Object.entries(cart).map(([itemId, qty]) => ({ itemId, qty }));
    if (!items.length || !data) return;
    await api(`/staff/sessions/${data.session.id}/orders`, {
      body: { guestId: guestId || null, items, idempotencyKey: crypto.randomUUID() },
      token,
    });
    setCart({});
    setAdding(false);
  });

  const bill = data?.bill;
  const due = bill ? bill.totalCents - bill.paidCents : 0;
  const itemName = (id: string) => menu?.flatMap((c) => c.items).find((i) => i.id === id)?.translations[me.defaultLanguage]?.name ?? "—";

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 p-4">
          <h2 className="text-xl font-bold">Mesa {table.label}</h2>
          <button className="btn btn-ghost !px-3 !py-1" onClick={onClose}>✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          {!table.sessionId && (
            <div className="text-center">
              <p className="mb-3 text-stone-600">Mesa libre.</p>
              {can("session.open") && <button className="btn btn-primary" onClick={openSession}>Abrir mesa</button>}
            </div>
          )}

          {data && !adding && (
            <>
              <p className="text-sm text-stone-600">
                Comensales: {data.guests.length ? data.guests.map((g) => g.alias).join(", ") : "—"} · Total <b>{money(data.totalCents)}</b>
              </p>
              {data.calls.filter((c) => c.status !== "done").map((c) => (
                <div key={c.id} className="rounded-lg bg-red-50 p-2 text-sm">{c.type === "bill" ? "🧾 Ha pedido la cuenta" : "🙋 Llama al camarero"}</div>
              ))}
              {data.orders.map((o) => (
                <div key={o.id} className="card p-3">
                  <div className="flex items-center justify-between text-sm">
                    <b>Ronda {o.round}</b>
                    <span className="text-stone-500">{o.source === "qr" ? `QR · ${o.guestAlias ?? ""}` : "Camarero"}{o.status === "pending_approval" && " · por aprobar"}</span>
                  </div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {o.items.map((i) => {
                      const next = allowedNextStatuses(me.role, i.fulfillment, i.status).filter((s) => s === "served" || s === "cancelled");
                      return (
                        <li key={i.id} className="flex items-center justify-between gap-2">
                          <span className={i.status === "cancelled" ? "line-through text-stone-400" : ""}>{i.qty}× {i.name}{i.note && <em className="text-red-700"> ({i.note})</em>}</span>
                          <span className="flex items-center gap-1">
                            <span className={`chip ${i.status === "ready" ? "!bg-emerald-100 !text-emerald-800" : ""}`}>{ITEM_LABEL[i.status]}</span>
                            {next.includes("served") && <button className="btn btn-ok !px-2 !py-0.5 !text-xs" onClick={() => run(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [i.id], status: "served" }, token }))}>Servido</button>}
                            {next.includes("cancelled") && <button className="btn btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => run(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [i.id], status: "cancelled" }, token }))}>Anular</button>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {o.status === "pending_approval" && can("orders.approve") && (
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-ok flex-1 !py-1.5" onClick={() => run(() => api(`/staff/orders/${o.id}/approve`, { body: {}, token }))}>Aprobar</button>
                      <button className="btn btn-danger flex-1 !py-1.5" onClick={() => run(() => api(`/staff/orders/${o.id}/reject`, { body: {}, token }))}>Rechazar</button>
                    </div>
                  )}
                </div>
              ))}
              {can("orders.create_for_guest") && <button className="btn btn-primary w-full" onClick={startAdd}>＋ Tomar pedido</button>}

              {canBill && data.totalCents > 0 && (
                <div className="card space-y-2 p-3">
                  <h3 className="font-semibold">Cuenta</h3>
                  {!bill || bill.status === "draft" || bill.totalCents !== data.totalCents - bill.discountCents ? (
                    <button className="btn btn-ghost w-full" onClick={() => run(() => api(`/staff/sessions/${data.session.id}/bill`, { body: {}, token }))}>
                      {bill ? "Regenerar cuenta" : "Generar cuenta"}
                    </button>
                  ) : null}
                  {bill && (
                    <>
                      <div className="flex justify-between text-sm"><span>Total</span><b>{money(bill.totalCents)}</b></div>
                      <div className="flex justify-between text-sm"><span>Cobrado</span><span>{money(bill.paidCents)}</span></div>
                      <div className="flex justify-between text-sm"><span>Pendiente</span><b>{money(due)}</b></div>
                      <a className="btn btn-ghost w-full" href={`/print/bill/${bill.id}`} target="_blank" rel="noreferrer"
                         onClick={() => void api(`/staff/bills/${bill.id}/printed`, { body: {}, token }).then(() => reload())}>
                        🖨 Imprimir cuenta
                      </a>
                      {due > 0 && (
                        <div className="space-y-2 border-t border-stone-100 pt-2">
                          <p className="text-xs text-stone-500">Cobra en tu datáfono o caja y registra aquí el pago.</p>
                          <div className="grid grid-cols-3 gap-1">
                            {(["card", "cash", "other"] as const).map((m) => (
                              <button key={m} onClick={() => setPay({ ...pay, method: m, amount: pay.amount || (due / 100).toFixed(2) })} className={`btn !py-1.5 ${pay.method === m ? "btn-primary" : "btn-ghost"}`}>
                                {m === "card" ? "Tarjeta" : m === "cash" ? "Efectivo" : "Otro"}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs">Importe (€)<input className="input !py-1.5" inputMode="decimal" value={pay.amount || (due / 100).toFixed(2)} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
                            <label className="text-xs">Propina (€)<input className="input !py-1.5" inputMode="decimal" value={pay.tip} onChange={(e) => setPay({ ...pay, tip: e.target.value })} placeholder="0.00" /></label>
                          </div>
                          <button className="btn btn-ok w-full" onClick={() => run(() => api(`/staff/bills/${bill.id}/payments`, {
                            body: {
                              method: pay.method,
                              amountCents: Math.round(parseFloat((pay.amount || (due / 100).toFixed(2)).replace(",", ".")) * 100),
                              tipCents: pay.tip ? Math.round(parseFloat(pay.tip.replace(",", ".")) * 100) : undefined,
                            },
                            token,
                          }).then(() => setPay({ method: pay.method, amount: "", tip: "" })))}>
                            Registrar cobro
                          </button>
                        </div>
                      )}
                      {bill.status === "paid" && <p className="rounded-lg bg-emerald-50 p-2 text-center text-sm text-emerald-800">Cuenta cobrada. La mesa queda libre.</p>}
                    </>
                  )}
                </div>
              )}
              {can("session.close_force") && (
                <button className="btn btn-ghost w-full !text-red-700" onClick={() => { if (confirm("¿Cerrar la mesa sin cobrar?")) void run(() => api(`/staff/sessions/${data.session.id}/close`, { body: { reason: "manual" }, token })); }}>
                  Cerrar mesa sin cobrar
                </button>
              )}
            </>
          )}

          {data && adding && (
            <div className="space-y-3">
              <label className="block text-sm">Pedido para
                <select className="input mt-1" value={guestId} onChange={(e) => setGuestId(e.target.value)}>
                  <option value="">Toda la mesa</option>
                  {data.guests.map((g) => <option key={g.id} value={g.id}>{g.alias}</option>)}
                </select>
              </label>
              {menu?.filter((c) => c.active).map((c) => (
                <div key={c.id}>
                  <h4 className="text-sm font-semibold text-stone-600">{c.translations[me.defaultLanguage]?.name}</h4>
                  <ul className="mt-1 space-y-1">
                    {c.items.filter((i) => i.active).map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className={i.available ? "" : "text-stone-400 line-through"}>{i.translations[me.defaultLanguage]?.name} <span className="text-stone-500">{money(i.priceCents)}</span></span>
                        <span className="flex items-center gap-1">
                          {cart[i.id] ? <button className="btn btn-ghost !px-2 !py-0.5" onClick={() => setCart((x) => { const n = { ...x }; if ((n[i.id] ?? 0) <= 1) delete n[i.id]; else n[i.id] = n[i.id]! - 1; return n; })}>−</button> : null}
                          {cart[i.id] ? <b className="w-5 text-center">{cart[i.id]}</b> : null}
                          <button disabled={!i.available} className="btn btn-primary !px-2 !py-0.5" onClick={() => setCart((x) => ({ ...x, [i.id]: Math.min(20, (x[i.id] ?? 0) + 1) }))}>＋</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="sticky bottom-0 flex gap-2 bg-white pt-2">
                <button className="btn btn-ghost flex-1" onClick={() => { setAdding(false); setCart({}); }}>Cancelar</button>
                <button className="btn btn-primary flex-1" disabled={!Object.keys(cart).length} onClick={sendOrder}>
                  Enviar ({Object.values(cart).reduce((a, b) => a + b, 0)})
                </button>
              </div>
              <span className="hidden">{itemName("")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FloorPage() {
  return (
    <StaffShell>
      <Floor />
    </StaffShell>
  );
}

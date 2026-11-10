"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  BellRing,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  ConciergeBell,
  CreditCard,
  ExternalLink,
  GlassWater,
  HandCoins,
  LayoutGrid,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  Smartphone,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { api, errorText, newId } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { beep, useShift } from "@/lib/sound";
import { useStaff } from "@/lib/staff-auth";
import { Drawer, EmptyState, ErrorBanner, Segmented, Stepper, cx, useToast } from "@/components/ui";
import { SoundHint, StaffShell, StartShift } from "../StaffShell";

const STATUS_STYLE: Record<TableStatus, { label: string; tile: string; dot: string; urgent?: boolean }> = {
  free: { label: "Libre", tile: "bg-white/60 border-dashed border-stone-300 text-stone-400", dot: "bg-stone-300" },
  occupied: { label: "Ocupada", tile: "bg-white border-stone-200", dot: "bg-sky-500" },
  waiting_food: { label: "Esperando platos", tile: "bg-white border-amber-200", dot: "bg-amber-500" },
  paying: { label: "Cuenta impresa", tile: "bg-violet-50 border-violet-200", dot: "bg-violet-500" },
  ready_to_serve: { label: "Listo para servir", tile: "bg-emerald-50 border-emerald-300", dot: "bg-emerald-500", urgent: true },
  pending_approval: { label: "Aprobar pedido", tile: "bg-orange-50 border-orange-300", dot: "bg-orange-500", urgent: true },
  calling: { label: "Llama", tile: "bg-red-50 border-red-300", dot: "bg-red-500", urgent: true },
  bill_requested: { label: "Pide la cuenta", tile: "bg-red-50 border-red-400", dot: "bg-red-600", urgent: true },
};
const ITEM_LABEL: Record<ItemStatus, string> = {
  pending_approval: "Por aprobar", new: "Nuevo", preparing: "Cocinando", ready: "Listo", served: "Servido", cancelled: "Anulado",
};
const ITEM_CHIP: Record<ItemStatus, string> = {
  pending_approval: "bg-orange-100 text-orange-800", new: "bg-sky-100 text-sky-800", preparing: "bg-amber-100 text-amber-800",
  ready: "bg-emerald-100 text-emerald-800", served: "bg-stone-100 text-stone-500", cancelled: "bg-stone-100 text-stone-400 line-through",
};

const since = (iso: string | null, now: number) => {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

type Filter = "all" | "attention" | "busy" | "free";

function Floor() {
  const { token, me, can } = useStaff();
  const [tables, setTables] = useState<StaffTableDTO[]>([]);
  const [tasks, setTasks] = useState<FloorTasksDTO | null>(null);
  const [open, setOpen] = useState<string | null>(null); // tableId
  const { started, soundOn, start } = useShift();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(() => Date.now());
  const prev = useRef<{ ready: Set<string>; serve: Set<string>; calls: Set<string>; appr: Set<string> } | null>(null);
  const money = (c: number) => formatMoney(c, me.defaultLanguage);

  const load = useCallback(async () => {
    try {
      const [t, k] = await Promise.all([
        api<StaffTableDTO[]>("/staff/tables", { token }),
        api<FloorTasksDTO>("/staff/floor/tasks", { token }),
      ]);
      const cur = {
        ready: new Set(k.ready.map((r) => r.itemId)),
        serve: new Set(k.serve.map((r) => r.itemId)),
        calls: new Set(k.calls.filter((c) => c.status === "open").map((c) => c.id)),
        appr: new Set(k.approvals.map((a) => a.orderId)),
      };
      const p = prev.current;
      if (p) {
        const newCall = k.calls.find((c) => c.status === "open" && !p.calls.has(c.id));
        if (newCall) beep(newCall.type === "bill" ? "bill" : "call");
        else if ([...cur.ready].some((i) => !p.ready.has(i)) || [...cur.serve].some((i) => !p.serve.has(i))) beep("ready");
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
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);
  useRealtime(token, () => void load());

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const serve = (id: string) => act(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [id], status: "served" }, token }));

  if (started === null) return null;
  if (!started) {
    return (
      <StartShift
        title="Sala"
        text="Activa los avisos sonoros (platos listos, bebidas, llamadas y cuentas) y mantén la pantalla encendida."
        icon={<ConciergeBell className="size-9" />}
        onStart={start}
      />
    );
  }

  const visible = tables.filter((t) =>
    filter === "all" ? true : filter === "free" ? t.status === "free" : filter === "busy" ? t.status !== "free" : STATUS_STYLE[t.status].urgent,
  );
  const zones = [...new Set(visible.map((t) => t.zoneName ?? "Sin zona"))];
  const openCalls = tasks?.calls.filter((c) => c.status !== "done") ?? [];
  const urgent = tasks ? openCalls.length + tasks.approvals.length + tasks.ready.length + tasks.serve.length : 0;
  const busy = tables.filter((t) => t.status !== "free");
  const attention = tables.filter((t) => STATUS_STYLE[t.status].urgent).length;

  return (
    <div className="mx-auto grid max-w-[1600px] gap-5 p-4 lg:grid-cols-[1fr_24rem]">
      <SoundHint on={soundOn} />
      <div className="min-w-0">
        {/* Resumen */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Mesas ocupadas", value: `${busy.length}/${tables.length}`, icon: LayoutGrid, cls: "text-sky-600 bg-sky-50" },
            { label: "Comensales", value: busy.reduce((n, t) => n + t.guestCount, 0), icon: Users, cls: "text-violet-600 bg-violet-50" },
            { label: "Requieren atención", value: attention, icon: BellRing, cls: attention ? "text-red-600 bg-red-50" : "text-stone-500 bg-stone-100" },
            { label: "En mesas abiertas", value: money(busy.reduce((n, t) => n + t.totalCents, 0)), icon: Wallet, cls: "text-emerald-600 bg-emerald-50" },
          ].map((s, i) => (
            <div key={s.label} className="card flex animate-fade-up items-center gap-3 p-4" style={{ animationDelay: `${i * 50}ms` }}>
              <span className={cx("grid size-11 shrink-0 place-items-center rounded-2xl", s.cls)}><s.icon className="size-5" /></span>
              <div className="min-w-0">
                <div className="truncate font-display text-2xl leading-tight font-semibold tabular-nums">{s.value}</div>
                <div className="truncate text-xs text-stone-500">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold">Mesas</h1>
          <Segmented
            className="ml-auto"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Todas" },
              { value: "attention", label: <>Atención{attention > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] text-white">{attention}</span>}</> },
              { value: "busy", label: "Ocupadas" },
              { value: "free", label: "Libres" },
            ]}
          />
        </div>
        {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
        {visible.length === 0 && <EmptyState icon={<LayoutGrid className="size-6" />} title="Nada por aquí">No hay mesas con este filtro.</EmptyState>}

        {zones.map((z) => (
          <section key={z} className="mb-6">
            <h2 className="label mb-2.5">{z}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {visible.filter((t) => (t.zoneName ?? "Sin zona") === z).map((t, i) => {
                const st = STATUS_STYLE[t.status];
                return (
                  <button
                    key={t.id}
                    onClick={() => setOpen(t.id)}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className={cx("group relative flex aspect-[5/4] animate-scale-in flex-col rounded-3xl border-2 p-4 text-left shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift", st.tile)}
                  >
                    <div className="flex items-start justify-between">
                      <b className={cx("font-display text-4xl leading-none font-semibold", t.status === "free" ? "text-stone-400" : "text-ink")}>{t.label}</b>
                      <span className={cx("relative mt-1 size-3 rounded-full", st.dot, st.urgent && "animate-ring")} style={st.urgent ? { color: "rgb(239 68 68 / .45)" } : undefined} />
                    </div>
                    <div className="mt-auto">
                      <div className={cx("text-sm font-semibold", t.status === "free" ? "text-stone-400" : "text-ink")}>{st.label}</div>
                      {t.sessionId ? (
                        <div className="mt-1 flex items-center justify-between text-xs text-stone-500">
                          <span className="flex items-center gap-2">
                            <span className="flex items-center gap-0.5"><Users className="size-3.5" />{t.guestCount}</span>
                            <span className="flex items-center gap-0.5"><Clock className="size-3.5" />{since(t.openedAt, now)}</span>
                          </span>
                          <b className="text-sm text-ink tabular-nums">{money(t.totalCents)}</b>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-stone-400">{t.capacity} plazas</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Tareas */}
      <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-display text-2xl font-semibold">Tareas</h2>
          {urgent > 0 && <span className="rounded-full bg-ink px-2.5 py-0.5 text-sm font-bold text-white tabular-nums">{urgent}</span>}
        </div>
        {tasks && urgent === 0 && (
          <EmptyState icon={<CheckCircle2 className="size-6 text-emerald-500" />} title="Todo al día">Los avisos aparecerán aquí con sonido.</EmptyState>
        )}
        <div className="space-y-2.5">
          {openCalls.map((c) => (
            <TaskCard key={c.id} tone="red" icon={c.type === "bill" ? <Receipt className="size-5" /> : <BellRing className="size-5" />} table={c.tableLabel}
              text={<>{c.type === "bill" ? "Pide la cuenta" : "Llama al camarero"}{c.status === "ack" && <span className="text-stone-400"> · en camino</span>}</>}
              onOpen={() => setOpen(tables.find((t) => t.sessionId === c.sessionId)?.id ?? null)}>
              {c.status === "open" && <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/staff/calls/${c.id}/ack`, { body: {}, token }))}>Voy</button>}
              <button className="btn btn-ok btn-sm" onClick={() => act(() => api(`/staff/calls/${c.id}/done`, { body: {}, token }))}><Check className="size-4" /></button>
            </TaskCard>
          ))}
          {tasks?.approvals.map((a) => (
            <TaskCard key={a.orderId} tone="orange" icon={<Smartphone className="size-5" />} table={a.tableLabel} text={`${a.itemCount} platos por aprobar`}
              onOpen={() => setOpen(tables.find((t) => t.sessionId === a.sessionId)?.id ?? null)}>
              <button className="btn btn-ok btn-sm" onClick={() => act(() => api(`/staff/orders/${a.orderId}/approve`, { body: {}, token }))} aria-label="Aprobar"><Check className="size-4" /></button>
              <button className="btn btn-danger btn-sm" onClick={() => act(() => api(`/staff/orders/${a.orderId}/reject`, { body: {}, token }))} aria-label="Rechazar"><X className="size-4" /></button>
            </TaskCard>
          ))}
          {tasks && tasks.ready.length > 0 && <h3 className="label pt-2">Listo en cocina</h3>}
          {tasks?.ready.map((r) => (
            <TaskCard key={r.itemId} tone="green" icon={<ChefHat className="size-5" />} table={r.tableLabel} text={`${r.qty}× ${r.name}`}>
              <button className="btn btn-ok btn-sm" onClick={() => serve(r.itemId)}>Servido</button>
            </TaskCard>
          ))}
          {tasks && tasks.serve.length > 0 && <h3 className="label pt-2">Bebidas y postres por llevar</h3>}
          {tasks?.serve.map((r) => (
            <TaskCard key={r.itemId} tone="sky" icon={<GlassWater className="size-5" />} table={r.tableLabel} text={`${r.qty}× ${r.name}`}>
              <button className="btn btn-ok btn-sm" onClick={() => serve(r.itemId)}>Servido</button>
            </TaskCard>
          ))}
        </div>
      </aside>

      {open && tables.find((t) => t.id === open) && (
        <TableDrawer table={tables.find((t) => t.id === open)!} onClose={() => setOpen(null)} onChanged={load} canBill={can("bill.manage")} />
      )}
    </div>
  );
}

const TONE = {
  red: "border-l-red-500 [&_.ic]:bg-red-50 [&_.ic]:text-red-600",
  orange: "border-l-orange-500 [&_.ic]:bg-orange-50 [&_.ic]:text-orange-600",
  green: "border-l-emerald-500 [&_.ic]:bg-emerald-50 [&_.ic]:text-emerald-600",
  sky: "border-l-sky-500 [&_.ic]:bg-sky-50 [&_.ic]:text-sky-600",
};
function TaskCard({ tone, icon, table, text, children, onOpen }: { tone: keyof typeof TONE; icon: React.ReactNode; table: string; text: React.ReactNode; children: React.ReactNode; onOpen?: () => void }) {
  return (
    <div className={cx("card flex animate-fade-up items-center gap-3 border-l-4 p-3", TONE[tone])}>
      <span className="ic grid size-10 shrink-0 place-items-center rounded-xl">{icon}</span>
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} disabled={!onOpen}>
        <b className="block text-sm">Mesa {table}</b>
        <span className="block truncate text-sm text-stone-600">{text}</span>
      </button>
      <div className="flex shrink-0 gap-1">{children}</div>
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
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"card" | "cash" | "other">("card");
  const [amount, setAmount] = useState<string | null>(null);
  const [tip, setTip] = useState("");
  const [paidDone, setPaidDone] = useState<{ total: number; tip: number } | null>(null);
  const toast = useToast();
  const money = (c: number) => formatMoney(c, me.defaultLanguage);
  const L = me.defaultLanguage;

  const reload = useCallback(async () => {
    if (!table.sessionId) return setData(null);
    try {
      setData(await api<StaffSessionDTO>(`/staff/sessions/${table.sessionId}`, { token }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [table.sessionId, token]);
  useEffect(() => void reload(), [reload, table.totalCents, table.status]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      setError(null);
      await fn();
      await reload();
      onChanged();
      if (ok) toast.show(ok);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const startAdd = async () => {
    setAdding(true);
    if (!menu) setMenu(await api<AdminCategoryDTO[]>("/staff/menu", { token }));
  };
  const sendOrder = () => run(async () => {
    const items = Object.entries(cart).map(([itemId, qty]) => ({ itemId, qty }));
    if (!items.length || !data) return;
    await api(`/staff/sessions/${data.session.id}/orders`, {
      body: { guestId: guestId || null, items, idempotencyKey: newId() },
      token,
    });
    setCart({});
    setAdding(false);
  }, "Pedido enviado");

  const bill = data?.bill;
  const due = bill ? bill.totalCents - bill.paidCents : 0;
  // La cuenta está desfasada si se ha pedido o anulado algo después de generarla
  const billStale = !bill || (bill.status !== "paid" && bill.totalCents !== data!.totalCents - bill.discountCents);
  const priceById = useMemo(() => new Map(menu?.flatMap((c) => c.items).map((i) => [i.id, i.priceCents]) ?? []), [menu]);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = Object.entries(cart).reduce((a, [id, q]) => a + (priceById.get(id) ?? 0) * q, 0);
  const amountCents = amount === null ? due : Math.round(parseFloat(amount.replace(",", ".") || "0") * 100);
  const tipCents = tip ? Math.round(parseFloat(tip.replace(",", ".")) * 100) || 0 : 0;

  const pay = () => run(async () => {
    const r = await api<{ status: string; totalCents: number; tipCents: number }>(`/staff/bills/${bill!.id}/payments`, {
      body: { method, amountCents, tipCents: tipCents || undefined },
      token,
    });
    setAmount(null);
    setTip("");
    if (r.status === "paid") setPaidDone({ total: r.totalCents, tip: r.tipCents });
  }, "Cobro registrado");

  const subtitle = data ? (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1"><Users className="size-3.5" />{data.guests.length}</span>
      <span>Total <b className="text-ink">{money(data.totalCents)}</b></span>
    </span>
  ) : table.sessionId ? "Cargando…" : "Libre";

  return (
    <Drawer open onClose={onClose} title={`Mesa ${table.label}`} subtitle={subtitle}>
      {toast.node}
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <ErrorBanner>{error}</ErrorBanner>
        <a className="flex items-center justify-between rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold shadow-soft ring-1 ring-stone-200/70 transition hover:ring-stone-300" href={`/q/${table.qrToken}`} target="_blank" rel="noreferrer">
          <span className="flex items-center gap-2"><QrCode className="size-4" /> Ver la carta de esta mesa (como el comensal)</span>
          <ExternalLink className="size-4 text-stone-400" />
        </a>

        {paidDone && (
          <div className="card animate-scale-in p-6 text-center">
            <div className="mx-auto mb-3 grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-9" /></div>
            <p className="font-display text-2xl font-semibold">Cuenta cobrada</p>
            <p className="text-sm text-stone-500">{money(paidDone.total)}{paidDone.tip > 0 && ` · propina ${money(paidDone.tip)}`}. La mesa queda libre.</p>
            <button className="btn btn-dark mt-4" onClick={onClose}>Volver a sala</button>
          </div>
        )}

        {!table.sessionId && !paidDone && (
          <EmptyState icon={<LayoutGrid className="size-6" />} title="Mesa libre">
            {table.capacity} plazas.{" "}
            {can("session.open") && (
              <button className="btn btn-primary mt-3 w-full" onClick={() => run(() => api(`/staff/tables/${table.id}/session`, { body: {}, token }), "Mesa abierta")}>
                Abrir mesa
              </button>
            )}
          </EmptyState>
        )}

        {data && !adding && !paidDone && (
          <>
            {data.guests.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.guests.map((g) => <span key={g.id} className="chip px-3! py-1! text-xs!"><UserRound className="size-3" /> {g.alias}</span>)}
              </div>
            )}
            {data.calls.filter((c) => c.status !== "done").map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800 ring-1 ring-red-200">
                {c.type === "bill" ? <Receipt className="size-4" /> : <BellRing className="size-4" />}
                {c.type === "bill" ? "Ha pedido la cuenta" : "Llama al camarero"}
              </div>
            ))}

            {data.orders.length === 0 && <EmptyState icon={<Receipt className="size-6" />} title="Sin pedidos">Toma el pedido o espera a que pidan desde el QR.</EmptyState>}
            {data.orders.map((o) => (
              <div key={o.id} className={cx("card overflow-hidden", o.status === "pending_approval" && "ring-2 ring-orange-300")}>
                <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-stone-50/60 px-4 py-2.5 text-sm">
                  <b>Ronda {o.round}</b>
                  <span className="flex items-center gap-1 text-xs text-stone-500">
                    {o.source === "qr" ? <><Smartphone className="size-3.5" /> {o.guestAlias ?? "QR"}</> : <><ConciergeBell className="size-3.5" /> Camarero</>}
                  </span>
                </div>
                <ul className="divide-y divide-stone-100 px-4">
                  {o.items.map((i) => {
                    const next = allowedNextStatuses(me.role, i.fulfillment, i.status).filter((s) => s === "served" || s === "cancelled");
                    return (
                      <li key={i.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                        <span className={cx("min-w-0", i.status === "cancelled" && "text-stone-400 line-through")}>
                          <b className="tabular-nums">{i.qty}×</b> {i.name}
                          {i.note && <em className="block text-xs text-red-700 not-italic">“{i.note}”</em>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className={cx("chip", ITEM_CHIP[i.status])}>{ITEM_LABEL[i.status]}</span>
                          {next.includes("served") && <button className="btn btn-ok btn-sm px-2!" title="Servido" onClick={() => run(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [i.id], status: "served" }, token }))}><Check className="size-3.5" /></button>}
                          {next.includes("cancelled") && <button className="btn btn-soft btn-sm px-2!" title="Anular" onClick={() => run(() => api("/staff/order-items/status", { method: "PATCH", body: { ids: [i.id], status: "cancelled" }, token }))}><X className="size-3.5" /></button>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {o.status === "pending_approval" && can("orders.approve") && (
                  <div className="flex gap-2 border-t border-orange-100 bg-orange-50/60 p-3">
                    <button className="btn btn-ok flex-1" onClick={() => run(() => api(`/staff/orders/${o.id}/approve`, { body: {}, token }), "Pedido aprobado")}><Check className="size-4" /> Aprobar</button>
                    <button className="btn btn-danger flex-1" onClick={() => run(() => api(`/staff/orders/${o.id}/reject`, { body: {}, token }))}><X className="size-4" /> Rechazar</button>
                  </div>
                )}
              </div>
            ))}
            {can("orders.create_for_guest") && <button className="btn btn-dark btn-lg w-full" onClick={startAdd}><Plus className="size-5" /> Tomar pedido</button>}

            {canBill && data.totalCents > 0 && (
              <div className="card space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-display text-xl font-semibold"><Receipt className="size-5" /> Cuenta</h3>
                  {bill && <span className={cx("chip", bill.status === "paid" ? "bg-emerald-100 text-emerald-800" : bill.status === "printed" ? "bg-violet-100 text-violet-800" : "")}>{bill.status === "draft" ? "Borrador" : bill.status === "printed" ? "Impresa" : "Pagada"}</span>}
                </div>
                {billStale && (
                  <button className="btn btn-ghost w-full" onClick={() => run(() => api(`/staff/sessions/${data.session.id}/bill`, { body: {}, token }))}>
                    {bill ? "Actualizar cuenta (hay pedidos nuevos)" : "Generar cuenta"}
                  </button>
                )}
                {bill && (
                  <>
                    <dl className="space-y-1 rounded-2xl bg-stone-50 p-3 text-sm">
                      <div className="flex justify-between"><dt className="text-stone-500">Total</dt><dd className="font-semibold tabular-nums">{money(bill.totalCents)}</dd></div>
                      <div className="flex justify-between"><dt className="text-stone-500">Cobrado</dt><dd className="tabular-nums">{money(bill.paidCents)}</dd></div>
                      <div className="flex justify-between border-t border-stone-200 pt-1"><dt className="font-semibold">Pendiente</dt><dd className="font-display text-xl font-semibold tabular-nums">{money(due)}</dd></div>
                    </dl>
                    {bill.byGuest.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {bill.byGuest.map((g, k) => <span key={k} className="chip">{g.alias ?? "Mesa"} · {money(g.totalCents)}</span>)}
                      </div>
                    )}
                    <a className="btn btn-ghost w-full" href={`/print/bill/${bill.id}`} target="_blank" rel="noreferrer"
                       onClick={() => void api(`/staff/bills/${bill.id}/printed`, { body: {}, token }).then(() => reload())}>
                      <Printer className="size-4" /> Imprimir cuenta
                    </a>
                    {due > 0 && !billStale && (
                      <div className="space-y-3 border-t border-stone-100 pt-3">
                        <p className="text-xs text-stone-500">Cobra en el datáfono o en caja del local y registra aquí el pago.</p>
                        <Segmented
                          className="w-full"
                          value={method}
                          onChange={setMethod}
                          options={[
                            { value: "card", label: <><CreditCard className="size-4" /> Tarjeta</> },
                            { value: "cash", label: <><HandCoins className="size-4" /> Efectivo</> },
                            { value: "other", label: "Otro" },
                          ]}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <label><span className="label">Importe (€)</span>
                            <input className="input" inputMode="decimal" value={amount ?? (due / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value)} />
                          </label>
                          <label><span className="label">Propina (€)</span>
                            <input className="input" inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0,00" />
                          </label>
                        </div>
                        {amountCents > 0 && amountCents < due && <p className="text-xs text-amber-700">Cobro parcial: quedarán {money(due - amountCents)} pendientes.</p>}
                        <button className="btn btn-ok btn-lg w-full" disabled={!(amountCents > 0 && amountCents <= due)} onClick={pay}>
                          <Check className="size-5" /> Registrar {money(amountCents > 0 ? amountCents : 0)}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {(can("session.close_force") || (can("session.open") && data.totalCents === 0)) && (
              <button
                className="btn w-full text-red-700 hover:bg-red-50"
                onClick={() => {
                  const msg = data.totalCents > 0 ? "¿Cerrar la mesa sin cobrar? Quedará registrado." : "¿Liberar la mesa?";
                  if (confirm(msg)) void run(() => api(`/staff/sessions/${data.session.id}/close`, { body: { reason: "manual" }, token }), "Mesa liberada");
                }}
              >
                {data.totalCents > 0 ? "Cerrar mesa sin cobrar" : "Liberar mesa"}
              </button>
            )}
          </>
        )}

        {data && adding && (
          <div className="space-y-4">
            <label className="block"><span className="label">Pedido para</span>
              <select className="input" value={guestId} onChange={(e) => setGuestId(e.target.value)}>
                <option value="">Toda la mesa</option>
                {data.guests.map((g) => <option key={g.id} value={g.id}>{g.alias}</option>)}
              </select>
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <input className="input pl-9" placeholder="Buscar plato" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {!menu && <div className="skeleton h-40" />}
            {menu?.filter((c) => c.active).map((c) => {
              const q = search.trim().toLocaleLowerCase();
              const items = c.items.filter((i) => i.active && (!q || (i.translations[L]?.name ?? "").toLocaleLowerCase().includes(q)));
              if (!items.length) return null;
              return (
                <div key={c.id}>
                  <h4 className="label">{c.translations[L]?.name}</h4>
                  <ul className="card divide-y divide-stone-100">
                    {items.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className={cx("min-w-0", !i.available && "text-stone-400 line-through")}>
                          <span className="font-medium">{i.translations[L]?.name}</span>
                          <span className="ml-1.5 text-stone-500 tabular-nums">{money(i.priceCents)}</span>
                        </span>
                        {cart[i.id] ? (
                          <Stepper size="sm" value={cart[i.id]!} onChange={(v) => setCart((x) => { const n = { ...x }; if (v <= 0) delete n[i.id]; else n[i.id] = Math.min(20, v); return n; })} />
                        ) : (
                          <button disabled={!i.available} className="btn-icon size-8! bg-ink text-white" onClick={() => setCart((x) => ({ ...x, [i.id]: 1 }))} aria-label="Añadir"><Plus className="size-4" /></button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-stone-200 bg-cream/95 px-5 py-3 backdrop-blur">
              <button className="btn btn-ghost" onClick={() => { setAdding(false); setCart({}); }}>Cancelar</button>
              <button className="btn btn-primary flex-1 justify-between" disabled={!cartCount} onClick={sendOrder}>
                <span>Enviar {cartCount > 0 && `(${cartCount})`}</span>
                <span className="tabular-nums">{money(cartTotal)}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default function FloorPage() {
  return (
    <StaffShell>
      <Floor />
    </StaffShell>
  );
}

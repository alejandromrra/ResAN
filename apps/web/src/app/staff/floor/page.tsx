"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allowedNextStatuses,
  formatMoney,
  type AdminCategoryDTO,
  type DelayDTO,
  type FloorTasksDTO,
  type ItemStatus,
  type StaffSessionDTO,
  type StaffTableDTO,
  type TableOfferDTO,
  type TableStatus,
  type WaiterLoadDTO,
  DELAY_LABEL,
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
  MapPin,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  Smartphone,
  Hand,
  Timer,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { api, errorText, newId } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { beep, useAlerts } from "@/lib/sound";
import { useStaff } from "@/lib/staff-auth";
import { Avatar, Drawer, EmptyState, ErrorBanner, Segmented, Stepper, cx, useToast } from "@/components/ui";
import { SoundHint, StaffShell } from "../StaffShell";
import { CashSheet, ShiftBar, ShiftGate } from "../shift";

const STATUS_STYLE: Record<TableStatus, { label: string; tile: string; dot: string; urgent?: boolean }> = {
  free: { label: "Libre", tile: "bg-white/60 border-dashed border-stone-300 text-stone-400", dot: "bg-stone-300" },
  occupied: { label: "Ocupada", tile: "bg-white border-stone-200", dot: "bg-sky-500" },
  waiting_food: { label: "En cocina", tile: "bg-white border-amber-200", dot: "bg-amber-500" },
  paying: { label: "Cuenta impresa", tile: "bg-violet-50 border-violet-200", dot: "bg-violet-500" },
  ready_to_serve: { label: "Hay que llevar", tile: "bg-emerald-50 border-emerald-300", dot: "bg-emerald-500", urgent: true },
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

const ASSIGN_LABEL = {
  opened: "Abrió la mesa",
  claimed: "La cogió del aviso",
  auto: "Asignada automáticamente",
  manager: "Asignada por el encargado",
  zone: "Camarero de la zona",
} as const;

const since = (iso: string | null, now: number) => {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const fmtMin = (m: number) => (m < 60 ? `${m}′` : `${Math.floor(m / 60)}h ${m % 60}′`);

/** Lo que hay que hacer en una mesa, agrupado para pintarlo dentro de su casilla. */
interface TableTodo {
  offer?: TableOfferDTO;
  bill?: string; // id de la llamada
  call?: string;
  approvals: string[]; // pedidos
  approvalItems: number;
  ready: string[];
  readyQty: number;
  serve: string[];
  serveQty: number;
  delays: DelayDTO[];
}
const emptyTodo = (): TableTodo => ({ approvals: [], approvalItems: 0, ready: [], readyQty: 0, serve: [], serveQty: 0, delays: [] });

function groupTodos(tasks: FloorTasksDTO | null): Map<string, TableTodo> {
  const m = new Map<string, TableTodo>();
  const of = (sid: string) => m.get(sid) ?? (m.set(sid, emptyTodo()), m.get(sid)!);
  if (!tasks) return m;
  for (const o of tasks.offers) of(o.sessionId).offer = o;
  for (const c of tasks.calls) if (c.status !== "done") of(c.sessionId)[c.type === "bill" ? "bill" : "call"] = c.id;
  for (const a of tasks.approvals) { const t = of(a.sessionId); t.approvals.push(a.orderId); t.approvalItems += a.itemCount; }
  for (const r of tasks.ready) { const t = of(r.sessionId); t.ready.push(r.itemId); t.readyQty += r.qty; }
  for (const r of tasks.serve) { const t = of(r.sessionId); t.serve.push(r.itemId); t.serveQty += r.qty; }
  for (const d of tasks.delays) of(d.sessionId).delays.push(d);
  return m;
}

function Floor() {
  const { token, me, can } = useStaff();
  const isManager = can("tables.assign");
  const [tables, setTables] = useState<StaffTableDTO[]>([]);
  const [tasks, setTasks] = useState<FloorTasksDTO | null>(null);
  const [open, setOpen] = useState<string | null>(null); // tableId
  const { soundOn } = useAlerts();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cashOpen, setCashOpen] = useState(false);
  const toast = useToast();
  const prev = useRef<{ ready: Set<string>; serve: Set<string>; calls: Set<string>; appr: Set<string>; offers: Set<string>; delays: Set<string> } | null>(null);
  const money = (c: number) => formatMoney(c, me.defaultLanguage);

  const load = useCallback(async () => {
    try {
      const [t, k] = await Promise.all([
        api<StaffTableDTO[]>("/staff/tables", { token }),
        api<FloorTasksDTO>("/staff/floor/tasks", { token }),
      ]);
      // Avisos sonoros: el camarero solo oye lo de sus mesas y las que no lleva nadie
      const zonesMine = new Set(k.waiters.find((w) => w.userId === me.userId)?.zoneIds ?? []);
      const relevantIds = new Set(
        t.filter((x) => {
          if (!x.sessionId) return false;
          if (isManager) return true;
          const mine = x.assignee?.userId === me.userId;
          const inMyArea = !zonesMine.size || (x.zoneId !== null && zonesMine.has(x.zoneId)) || mine;
          return inMyArea && (!x.assignee || mine);
        }).map((x) => x.sessionId!),
      );
      const rel = <T extends { sessionId: string }>(xs: T[]) => xs.filter((x) => relevantIds.has(x.sessionId));
      const cur = {
        ready: new Set(rel(k.ready).map((r) => r.itemId)),
        serve: new Set(rel(k.serve).map((r) => r.itemId)),
        calls: new Set(rel(k.calls).filter((c) => c.status === "open").map((c) => c.id)),
        appr: new Set(rel(k.approvals).map((a) => a.orderId)),
        offers: new Set(k.offers.filter((o) => o.offeredToMe || isManager).map((o) => o.sessionId)),
        delays: new Set(rel(k.delays).map((d) => `${d.kind}:${d.sessionId}:${d.itemId ?? ""}`)),
      };
      const p = prev.current;
      if (p) {
        const newCall = k.calls.find((c) => cur.calls.has(c.id) && !p.calls.has(c.id));
        if (newCall) beep(newCall.type === "bill" ? "bill" : "call");
        else if ([...cur.offers].some((i) => !p.offers.has(i))) beep("call");
        else if ([...cur.ready].some((i) => !p.ready.has(i)) || [...cur.serve].some((i) => !p.serve.has(i))) beep("ready");
        else if ([...cur.appr].some((i) => !p.appr.has(i))) beep("call");
        else if ([...cur.delays].some((i) => !p.delays.has(i))) beep("call");
      }
      prev.current = cur;
      setTables(t);
      setTasks(k);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [token, isManager, me.userId]);

  useEffect(() => void load(), [load]);
  // Los retrasos dependen del reloj: se recalculan aunque no haya eventos
  useEffect(() => {
    const i = setInterval(() => void load(), 60_000);
    return () => clearInterval(i);
  }, [load]);
  const hasOffers = (tasks?.offers.length ?? 0) > 0;
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), hasOffers ? 1_000 : 30_000);
    return () => clearInterval(i);
  }, [hasOffers]);
  useRealtime(token, () => void load());

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await load();
      if (ok) toast.show(ok);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const serve = (ids: string[], ok: string) => act(() => api("/staff/order-items/status", { method: "PATCH", body: { ids, status: "served" }, token }), ok);

  const todos = useMemo(() => groupTodos(tasks), [tasks]);
  const myZones = new Set(tasks?.waiters.find((w) => w.userId === me.userId)?.zoneIds ?? []);
  /** El camarero actúa en sus mesas y en las que no lleva nadie; el encargado, en todas. */
  const canAct = (t: StaffTableDTO) => isManager || !t.assignee || t.assignee.userId === me.userId;

  /**
   * El camarero solo ve las mesas que le tocan: las de sus zonas y las que lleva él en otra zona.
   * Si aún no tiene zona asignada, ve todo el local.
   */
  const visible = tables.filter((t) =>
    isManager || !myZones.size || (t.zoneId !== null && myZones.has(t.zoneId)) || t.assignee?.userId === me.userId,
  );
  const visibleSessions = new Set(visible.map((t) => t.sessionId).filter(Boolean));
  // Zonas: primero las mías
  const zoneKeys = [...new Set(visible.map((t) => t.zoneId ?? ""))].sort((a, b) => Number(myZones.has(b)) - Number(myZones.has(a)));
  const zoneInfo = new Map(tasks?.zones.map((z) => [z.id, z]) ?? []);
  const offers = tasks?.offers.filter((o) => isManager || (o.offeredToMe && visibleSessions.has(o.sessionId))) ?? [];
  const busy = tables.filter((t) => t.status !== "free");
  const delays = (tasks?.delays ?? []).filter((d) => isManager || !d.assigneeId || d.assigneeId === me.userId);
  const delaysByWaiter = new Map<string, number>();
  for (const d of tasks?.delays ?? []) if (d.assigneeId) delaysByWaiter.set(d.assigneeId, (delaysByWaiter.get(d.assigneeId) ?? 0) + 1);

  const tileActions = (t: StaffTableDTO) => {
    const todo = t.sessionId ? todos.get(t.sessionId) : undefined;
    if (!todo || !canAct(t)) return null;
    const sid = t.sessionId!;
    const out: { key: string; tone: string; icon: React.ReactNode; label: string; run: () => void }[] = [];
    if (todo.offer && can("session.open") && !isManager)
      out.push({ key: "offer", tone: "bg-ink text-white hover:bg-stone-800", icon: <Hand className="size-4" />, label: "Me la quedo", run: () => act(() => api(`/staff/sessions/${sid}/claim`, { body: {}, token }), `Mesa ${t.label} es tuya`) });
    if (todo.bill)
      out.push({ key: "bill", tone: "bg-red-600 text-white hover:bg-red-700", icon: <Receipt className="size-4" />, label: "Cobrar", run: () => setOpen(t.id) });
    if (todo.call)
      out.push({ key: "call", tone: "bg-red-600 text-white hover:bg-red-700", icon: <BellRing className="size-4" />, label: "Llama · Atendido", run: () => act(() => api(`/staff/calls/${todo.call}/done`, { body: {}, token }), "Llamada atendida") });
    if (todo.approvals.length && can("orders.approve"))
      out.push({ key: "appr", tone: "bg-orange-500 text-white hover:bg-orange-600", icon: <Smartphone className="size-4" />, label: `Aprobar ${todo.approvalItems}`, run: () => act(async () => { for (const id of todo.approvals) await api(`/staff/orders/${id}/approve`, { body: {}, token }); }, "Pedido aprobado") });
    if (todo.ready.length)
      out.push({ key: "ready", tone: "bg-emerald-600 text-white hover:bg-emerald-700", icon: <ChefHat className="size-4" />, label: `Llevar ${todo.readyQty} ${todo.readyQty === 1 ? "plato" : "platos"}`, run: () => serve(todo.ready, `Mesa ${t.label}: platos servidos`) });
    if (todo.serve.length)
      out.push({ key: "serve", tone: "bg-sky-600 text-white hover:bg-sky-700", icon: <GlassWater className="size-4" />, label: `Llevar ${todo.serveQty} ${todo.serveQty === 1 ? "bebida" : "bebidas"}`, run: () => serve(todo.serve, `Mesa ${t.label}: servido`) });
    return out;
  };

  return (
    <div className={cx("mx-auto grid max-w-[1600px] gap-5 p-4", isManager && "lg:grid-cols-[1fr_22rem]")}>
      <SoundHint on={soundOn} />
      {toast.node}
      {isManager && <div className="lg:col-span-2 -mb-4"><ShiftBar /></div>}
      <div className="min-w-0">
        {/* Mesas abiertas por clientes sin camarero */}
        {offers.length > 0 && (
          <div className="mb-5 space-y-2.5">
            {offers.map((o) => {
              const left = Math.max(0, Math.round((new Date(o.autoAssignAt).getTime() - now) / 1000));
              return (
                <div key={o.sessionId} className="flex animate-scale-in flex-wrap items-center gap-3 rounded-3xl bg-ink p-4 text-white shadow-lift">
                  <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-500 font-display text-xl font-semibold">
                    {o.tableLabel}
                    <span className="absolute -top-1 -right-1 size-3 animate-ring rounded-full bg-amber-400 text-amber-400/60" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block">Mesa {o.tableLabel} abierta por un cliente</b>
                    <span className="text-sm text-white/60">
                      Sin camarero. Se asigna sola en{" "}
                      <b className="text-amber-300 tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b>
                    </span>
                  </div>
                  {can("session.open") && (
                    <button className="btn bg-white text-ink hover:bg-stone-100" onClick={() => act(() => api(`/staff/sessions/${o.sessionId}/claim`, { body: {}, token }), `Mesa ${o.tableLabel} es tuya`)}>
                      <Hand className="size-4" /> Me la quedo
                    </button>
                  )}
                  {isManager && tasks && (
                    <AssignSelect waiters={tasks.waiters} value={null} onChange={(userId) => act(() => api(`/staff/sessions/${o.sessionId}/assign`, { body: { userId }, token }), `Mesa ${o.tableLabel} asignada`)} dark />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Resumen del encargado */}
        {isManager && (
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Mesas ocupadas", value: `${busy.length}/${tables.length}`, icon: LayoutGrid, cls: "text-sky-600 bg-sky-50" },
              { label: "Comensales", value: busy.reduce((n, t) => n + t.guestCount, 0), icon: Users, cls: "text-violet-600 bg-violet-50" },
              { label: "Retrasos", value: delays.length, icon: Timer, cls: delays.length ? "text-red-600 bg-red-50" : "text-stone-500 bg-stone-100" },
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
        )}

        {/* Equipo de sala (encargado) */}
        {isManager && tasks && tasks.waiters.length > 0 && (
          <div className="scrollbar-none mb-5 flex gap-2 overflow-x-auto">
            {tasks.waiters.map((w) => {
              const late = delaysByWaiter.get(w.userId) ?? 0;
              return (
                <div key={w.userId} className="card flex shrink-0 items-center gap-2.5 py-2 pr-4 pl-2">
                  <span className="relative">
                    <Avatar name={w.name} />
                    <span className={cx("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-white", w.online ? "bg-emerald-500" : "bg-stone-300")} />
                  </span>
                  <div className="leading-tight">
                    <b className="block text-sm">{w.name}</b>
                    <span className="text-xs text-stone-500">{w.openTables} {w.openTables === 1 ? "mesa" : "mesas"}</span>
                    {late > 0 && <span className="ml-1.5 text-xs font-semibold text-red-600">· {late} retraso{late > 1 ? "s" : ""}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isManager ? (
          <h1 className="mb-4 font-display text-3xl font-semibold">Mesas</h1>
        ) : (
          can("bill.manage") && (
            <div className="mb-3 flex justify-end">
              <button className="btn btn-ghost btn-sm" onClick={() => setCashOpen(true)}><Receipt className="size-3.5" /> Mi caja</button>
            </div>
          )
        )}
        {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
        {tasks && visible.length === 0 && (
          <EmptyState icon={<LayoutGrid className="size-6" />} title="Sin mesas asignadas">El encargado aún no te ha asignado ninguna zona.</EmptyState>
        )}

        {zoneKeys.map((zk) => {
          const z = zk ? zoneInfo.get(zk) : undefined;
          const name = visible.find((t) => (t.zoneId ?? "") === zk)?.zoneName ?? "Sin zona";
          return (
            <section key={zk || "none"} className="mb-6">
              <h2 className="mb-2.5 flex flex-wrap items-center gap-2">
                <span className="label mb-0!">{name}</span>
                {isManager && z && z.staff.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-stone-500"><MapPin className="size-3" />{z.staff.map((s) => s.name).join(", ")}</span>
                )}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {visible.filter((t) => (t.zoneId ?? "") === zk).map((t, i) => {
                  const st = STATUS_STYLE[t.status];
                  const mine = t.assignee?.userId === me.userId;
                  const late = t.delayMinutes > 0 && canAct(t);
                  const actions = tileActions(t);
                  const others = !isManager && !!t.assignee && !mine;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpen(t.id)}
                      onKeyDown={(e) => e.key === "Enter" && setOpen(t.id)}
                      style={{ animationDelay: `${i * 30}ms` }}
                      className={cx(
                        "group relative flex min-h-36 animate-scale-in cursor-pointer flex-col rounded-3xl border-2 p-4 text-left shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift",
                        st.tile,
                        late && "border-red-400 ring-4 ring-red-100",
                        !isManager && mine && !late && "ring-4 ring-sky-100",
                        others && "opacity-55",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <b className={cx("font-display text-4xl leading-none font-semibold", t.status === "free" ? "text-stone-400" : "text-ink")}>{t.label}</b>
                        {late ? (
                          <span className="flex animate-pulse items-center gap-0.5 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white"><Timer className="size-3" />{fmtMin(t.delayMinutes)}</span>
                        ) : (
                          <span className={cx("relative mt-1 size-3 rounded-full", st.dot, st.urgent && "animate-ring")} style={st.urgent ? { color: "rgb(239 68 68 / .45)" } : undefined} />
                        )}
                      </div>
                      <div className="mt-auto pt-3">
                        <div className={cx("text-sm font-semibold", t.status === "free" ? "text-stone-400" : "text-ink")}>{st.label}</div>
                        {t.sessionId ? (
                          <>
                            <div className="mt-1 flex items-center justify-between text-xs text-stone-500">
                              <span className="flex items-center gap-2">
                                <span className="flex items-center gap-0.5"><Users className="size-3.5" />{t.guestCount}</span>
                                <span className="flex items-center gap-0.5 whitespace-nowrap"><Clock className="size-3.5" />{since(t.openedAt, now)}</span>
                              </span>
                              <b className="text-sm text-ink tabular-nums">{money(t.totalCents)}</b>
                            </div>
                            <div className="mt-2 border-t border-stone-900/5 pt-2">
                              {t.assignee ? (
                                <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-xs font-semibold", mine ? "bg-sky-100 text-sky-900" : "bg-stone-900/5 text-stone-700")}>
                                  <Avatar name={t.assignee.name} className="size-5! text-[9px]!" />
                                  <span className="truncate">{mine ? "Tú" : t.assignee.name}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800"><UserRound className="size-3" /> Sin camarero</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 text-xs text-stone-400">{t.capacity} plazas</div>
                        )}
                        {actions && actions.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            {actions.map((a) => (
                              <button
                                key={a.key}
                                className={cx("flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-bold shadow-soft transition active:scale-95", a.tone)}
                                onClick={(e) => { e.stopPropagation(); a.run(); }}
                              >
                                {a.icon} {a.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Retrasos (encargado) */}
      {isManager && (
        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-display text-2xl font-semibold">Retrasos</h2>
            {delays.length > 0 && <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-sm font-bold text-white tabular-nums">{delays.length}</span>}
          </div>
          {tasks && delays.length === 0 && (
            <EmptyState icon={<CheckCircle2 className="size-6 text-emerald-500" />} title="Todo al día">Si algo se retrasa, aparecerá aquí con quién lleva la mesa.</EmptyState>
          )}
          <div className="space-y-2.5">
            {delays.map((d) => (
              <TaskCard key={`${d.kind}:${d.sessionId}:${d.itemId ?? ""}`} tone="late" icon={<Timer className="size-5" />} table={d.tableLabel}
                text={<>{DELAY_LABEL[d.kind]}{d.itemName && <> · {d.qty}× {d.itemName}</>}<span className="text-stone-400"> · {d.assigneeName ?? "sin camarero"}</span></>}
                onOpen={() => setOpen(tables.find((t) => t.sessionId === d.sessionId)?.id ?? null)}>
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">{fmtMin(d.minutes)}</span>
              </TaskCard>
            ))}
          </div>
        </aside>
      )}

      {!isManager && <CashSheet open={cashOpen} onClose={() => setCashOpen(false)} />}
      {open && tables.find((t) => t.id === open) && (
        <TableDrawer table={tables.find((t) => t.id === open)!} waiters={tasks?.waiters ?? []} onClose={() => setOpen(null)} onChanged={load} canBill={can("bill.manage")} />
      )}
    </div>
  );
}

/** Selector para que el encargado asigne una mesa a un camarero. */
function AssignSelect({ waiters, value, onChange, dark }: { waiters: WaiterLoadDTO[]; value: string | null; onChange: (userId: string) => void; dark?: boolean }) {
  return (
    <select
      className={cx("rounded-xl px-3 py-2 text-sm font-semibold", dark ? "bg-white/10 text-white ring-1 ring-white/20" : "input w-auto!")}
      value={value ?? ""}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    >
      <option value="">{value ? "Reasignar a…" : "Asignar a…"}</option>
      {waiters.map((w) => (
        <option key={w.userId} value={w.userId} className="text-ink">{w.name} · {w.openTables} mesas{w.online ? "" : " (desconectado)"}</option>
      ))}
    </select>
  );
}

const TONE = {
  late: "border-l-red-600 bg-red-50/60 [&_.ic]:bg-red-600 [&_.ic]:text-white",
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

function TableDrawer({ table, waiters, onClose, onChanged, canBill }: { table: StaffTableDTO; waiters: WaiterLoadDTO[]; onClose: () => void; onChanged: () => void; canBill: boolean }) {
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
        {table.sessionId && !paidDone && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-soft ring-1 ring-stone-200/70">
            {table.assignee ? (
              <>
                <Avatar name={table.assignee.name} />
                <div className="min-w-0 flex-1 leading-tight">
                  <b className="block text-sm">{table.assignee.userId === me.userId ? "La llevas tú" : `La lleva ${table.assignee.name}`}</b>
                  <span className="text-xs text-stone-500">{ASSIGN_LABEL[table.assignee.mode]}</span>
                </div>
              </>
            ) : (
              <div className="min-w-0 flex-1 text-sm"><b className="block text-amber-700">Sin camarero</b><span className="text-xs text-stone-500">La abrió un cliente desde el QR.</span></div>
            )}
            {!table.assignee && can("session.open") && (
              <button className="btn btn-dark btn-sm" onClick={() => run(() => api(`/staff/sessions/${table.sessionId}/claim`, { body: {}, token }), "Mesa asignada a ti")}>
                <Hand className="size-3.5" /> Me la quedo
              </button>
            )}
            {can("tables.assign") && (
              <AssignSelect waiters={waiters} value={table.assignee?.userId ?? null} onChange={(userId) => run(() => api(`/staff/sessions/${table.sessionId}/assign`, { body: { userId }, token }), "Mesa reasignada")} />
            )}
          </div>
        )}
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
      <ShiftGate>
        <Floor />
      </ShiftGate>
    </StaffShell>
  );
}

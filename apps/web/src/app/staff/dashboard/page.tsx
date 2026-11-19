"use client";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DELAY_LABEL, DELAY_THRESHOLDS, PAYMENT_METHODS, formatMoney, type DelayDTO, type ShiftDTO, type StaffStatsDTO, type StatsDTO } from "@resan/shared";
import { CalendarDays, CheckCircle2, ChefHat, Receipt, Clock, Coins, ConciergeBell, Flame, LayoutGrid, Radio, Timer, TrendingUp, Utensils } from "lucide-react";
import { ApiError, api, errorText } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useStaff } from "@/lib/staff-auth";
import { Avatar, EmptyState, ErrorBanner, cx } from "@/components/ui";
import { ROLE_LABEL, StaffShell } from "../StaffShell";
import { CashSheet, METHOD_LABEL } from "../shift";

/** Duración legible: 45 s, 3:20 min, 1 h 05 min. */
function dur(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(Math.round(s % 60)).padStart(2, "0")} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

function verdict(r: StaffStatsDTO): { label: string; cls: string; bar: string } {
  if (r.onTimePct === null) return { label: "Sin actividad", cls: "bg-stone-100 text-stone-500", bar: "bg-stone-300" };
  if (r.onTimePct >= 90) return { label: "Muy eficiente", cls: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-500" };
  if (r.onTimePct >= 75) return { label: "Bien", cls: "bg-amber-100 text-amber-800", bar: "bg-amber-400" };
  return { label: "Con retrasos", cls: "bg-red-100 text-red-800", bar: "bg-red-500" };
}

const shiftLabel = (s: ShiftDTO) => {
  const d = new Date(s.openedAt);
  const h = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} · ${h(s.openedAt)}–${s.closedAt ? h(s.closedAt) : "en curso"}`;
};

function Dashboard() {
  const { token, me } = useStaff();
  const params = useSearchParams();
  const router = useRouter();
  const shiftId = params.get("shift") ?? "";
  const justClosed = params.get("closed") === "1";
  const [data, setData] = useState<StatsDTO | null>(null);
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [delays, setDelays] = useState<DelayDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [cashFor, setCashFor] = useState<StaffStatsDTO | null>(null);
  const money = (c: number) => formatMoney(c, me.defaultLanguage);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        api<StatsDTO>(`/staff/stats${shiftId ? `?shift=${shiftId}` : ""}`, { token }),
        api<ShiftDTO[]>("/staff/shifts", { token }),
      ]);
      setData(s);
      setShifts(list);
      setDelays(s.live ? await api<DelayDTO[]>("/staff/delays", { token }) : []);
      setError(null);
      setEmpty(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_shift") setEmpty(true);
      else setError(errorText(e));
    }
  }, [token, shiftId]);

  useEffect(() => void load(), [load]);
  // En vivo: se actualiza con cada evento y cada 30 s (los retrasos dependen del reloj)
  useRealtime(data?.live ? token : null, () => void load());
  useEffect(() => {
    if (!data?.live) return;
    const i = setInterval(() => void load(), 30_000);
    return () => clearInterval(i);
  }, [data?.live, load]);

  const t = data?.totals;
  const active = data?.staff.filter((r) => r.onTimePct !== null || r.openTables > 0 || r.tablesAssigned > 0) ?? [];
  const idle = data?.staff.filter((r) => !active.includes(r)) ?? [];

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-4xl font-semibold">{justClosed ? "Resumen del turno" : "Panel del equipo"}</h1>
          <p className="text-sm text-stone-500">Rendimiento de cada empleado en el turno: puntualidad, tiempos, retrasos y caja.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data?.live ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800"><Radio className="size-3.5 animate-pulse" /> En vivo</span>
          ) : data ? (
            <span className="rounded-full bg-stone-200 px-3 py-1.5 text-xs font-bold text-stone-600">Turno cerrado</span>
          ) : null}
          {shifts.length > 0 && (
            <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-soft ring-1 ring-stone-200/70">
              <CalendarDays className="size-4 text-stone-500" />
              <select className="bg-transparent font-semibold outline-none" value={data?.shift.id ?? ""} onChange={(e) => router.push(`/staff/dashboard?shift=${e.target.value}`)}>
                {shifts.map((x) => <option key={x.id} value={x.id}>{shiftLabel(x)}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      {justClosed && data && (
        <div className="mb-5 flex animate-fade-up items-center gap-3 rounded-3xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          <CheckCircle2 className="size-6 shrink-0" />
          <div className="text-sm"><b className="block">Turno cerrado{data.shift.closedBy ? ` por ${data.shift.closedBy}` : ""}.</b>Este es el balance del turno: cada camarero y cocinero, los retrasos y la caja de cada uno.</div>
        </div>
      )}
      {empty && <EmptyState icon={<CalendarDays className="size-6" />} title="Aún no hay turnos">El panel se llena en cuanto inicies el primer turno desde Sala o Cocina.</EmptyState>}
      <ErrorBanner>{error}</ErrorBanner>
      {!data && !error && !empty && <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-28" />)}</div>}

      {t && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={LayoutGrid} cls="bg-sky-50 text-sky-600" label="Mesas atendidas" value={t.tablesServed} />
          <Kpi icon={Coins} cls="bg-emerald-50 text-emerald-600" label="Cobrado" value={money(t.revenueCents)} sub={t.tipsCents ? `+ ${money(t.tipsCents)} propinas` : undefined} />
          <Kpi icon={Utensils} cls="bg-violet-50 text-violet-600" label="Platos servidos" value={t.itemsServed} />
          <Kpi icon={ConciergeBell} cls="bg-brand-50 text-brand-600" label="Tiempo medio en llevar" value={dur(t.avgServeSeconds)} />
          <Kpi icon={ChefHat} cls="bg-amber-50 text-amber-600" label="Tiempo medio de cocina" value={dur(t.avgPrepSeconds)} />
          <Kpi icon={Timer} cls={t.lateEvents ? "bg-red-50 text-red-600" : "bg-stone-100 text-stone-500"} label="Fuera de tiempo" value={t.lateEvents} sub={data.live ? `${t.activeDelays} activos ahora` : undefined} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section>
          {data && active.length === 0 && (
            <EmptyState icon={<TrendingUp className="size-6" />} title="Sin actividad">{data.live ? "Las estadísticas aparecen en cuanto el equipo empiece a atender mesas." : "En este turno no hubo servicio registrado."}</EmptyState>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {active.map((r, i) => <StaffCard key={r.userId} r={r} live={!!data?.live} money={money} delay={i * 50} onCash={() => setCashFor(r)} />)}
          </div>
          {data && cashFor && (
            <CashSheet open onClose={() => setCashFor(null)} shiftId={data.shift.id} userId={cashFor.userId} title={`Caja de ${cashFor.name}`} />
          )}
          {idle.length > 0 && (
            <div className="mt-5">
              <h3 className="label">Sin actividad en el turno</h3>
              <div className="flex flex-wrap gap-2">
                {idle.map((r) => (
                  <span key={r.userId} className="flex items-center gap-2 rounded-full bg-white py-1 pr-3 pl-1 text-sm shadow-soft ring-1 ring-stone-200/70">
                    <Avatar name={r.name} className="size-7! text-[10px]!" /> {r.name} <span className="text-xs text-stone-400">{ROLE_LABEL[r.role]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {data?.live && (
          <aside className="xl:sticky xl:top-20 xl:self-start">
            <h2 className="mb-3 flex items-center gap-2 font-display text-2xl font-semibold"><Flame className="size-5 text-red-500" /> Retrasos ahora</h2>
            {delays.length === 0 ? (
              <EmptyState icon={<Clock className="size-6 text-emerald-500" />} title="Todo a tiempo">No hay ningún retraso en sala ni en cocina.</EmptyState>
            ) : (
              <div className="space-y-2">
                {delays.map((d) => (
                  <div key={`${d.kind}:${d.sessionId}:${d.itemId ?? ""}`} className="card flex items-center gap-3 border-l-4 border-l-red-500 p-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <b className="block">Mesa {d.tableLabel} · {DELAY_LABEL[d.kind]}</b>
                      <span className="block truncate text-stone-500">
                        {d.itemName ? `${d.qty}× ${d.itemName} · ` : ""}{d.audience === "kitchen" ? "Cocina" : d.assigneeName ?? "Sin camarero"}
                      </span>
                    </div>
                    <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">{d.minutes}′</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-stone-400">
              Se considera retraso: plato listo sin llevar {DELAY_THRESHOLDS.readyNotServed} min, bebida sin llevar {DELAY_THRESHOLDS.drinkNotServed} min,
              llamada sin atender {DELAY_THRESHOLDS.callUnanswered} min y plato que pasa {DELAY_THRESHOLDS.kitchenSlow} min de su tiempo de cocina.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, cls, label, value, sub }: { icon: typeof Clock; cls: string; label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card animate-fade-up p-4">
      <span className={cx("mb-3 grid size-10 place-items-center rounded-2xl", cls)}><Icon className="size-5" /></span>
      <div className="font-display text-2xl leading-tight font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs font-medium text-stone-400">{sub}</div>}
    </div>
  );
}

function StaffCard({ r, live, money, delay, onCash }: { r: StaffStatsDTO; live: boolean; money: (c: number) => string; delay: number; onCash: () => void }) {
  const v = verdict(r);
  const floorWork = r.tablesAssigned + r.itemsServed + r.callsHandled + r.payments + r.openTables > 0;
  const kitchenWork = r.itemsPrepared > 0 || r.role === "kitchen";
  return (
    <article className="card animate-fade-up overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3 p-4">
        <span className="relative">
          <Avatar name={r.name} className="size-12! text-sm!" />
          {live && <span className={cx("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-white", r.online ? "bg-emerald-500" : "bg-stone-300")} />}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-lg leading-tight">{r.name}</b>
          <span className="text-xs text-stone-500">{ROLE_LABEL[r.role]}{live && (r.online ? " · conectado" : " · desconectado")}</span>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl leading-none font-semibold tabular-nums">{r.onTimePct === null ? "—" : `${r.onTimePct}%`}</div>
          <span className={cx("mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold", v.cls)}>{v.label}</span>
        </div>
      </div>
      <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-stone-100">
        <div className={cx("h-full rounded-full transition-all duration-700", v.bar)} style={{ width: `${r.onTimePct ?? 0}%` }} />
      </div>
      <div className="px-4 pt-1 pb-1 text-[11px] text-stone-400">tareas hechas a tiempo</div>

      {live && (r.openTables > 0 || r.activeDelays > 0) && (
        <div className="mx-4 mt-2 flex gap-2 text-xs font-semibold">
          {r.openTables > 0 && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">Ahora: {r.openTables} {r.openTables === 1 ? "mesa" : "mesas"}</span>}
          {r.activeDelays > 0 && <span className="animate-pulse rounded-full bg-red-600 px-2.5 py-1 text-white">{r.activeDelays} {r.activeDelays === 1 ? "retraso" : "retrasos"} ahora</span>}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-px bg-stone-100 p-px pt-0 mt-3 text-sm sm:grid-cols-3">
        {floorWork && (
          <>
            <Metric label="Mesas" value={r.tablesAssigned} sub={r.assignedBy.auto ? `${r.assignedBy.auto} asignadas solas` : r.avgClaimSeconds !== null ? `coge en ${dur(r.avgClaimSeconds)}` : undefined} />
            <Metric label="Platos servidos" value={r.itemsServed} sub={r.avgServeSeconds !== null ? `en ${dur(r.avgServeSeconds)} de media` : undefined} />
            <Metric label="Llevados tarde" value={r.lateServes} bad={r.lateServes > 0} />
            <Metric label="Llamadas" value={r.callsHandled} sub={r.avgCallSeconds !== null ? `responde en ${dur(r.avgCallSeconds)}` : undefined} />
            <Metric label="Llamadas tarde" value={r.lateCalls} bad={r.lateCalls > 0} />
            <Metric label="Cobrado" value={money(r.revenueCents)} sub={r.payments ? `${r.payments} ${r.payments === 1 ? "cobro" : "cobros"}${r.tipsCents ? ` · ${money(r.tipsCents)} propina` : ""}` : undefined} />
          </>
        )}
        {r.payments > 0 && (
          <div className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1 bg-white px-4 py-3">
            <span className="text-[11px] font-semibold tracking-wide text-stone-400 uppercase">Caja</span>
            {PAYMENT_METHODS.map((m) => (
              <span key={m} className="text-sm">{METHOD_LABEL[m]} <b className="tabular-nums">{money(r.byMethod[m])}</b></span>
            ))}
            <button className="btn btn-ghost btn-sm ml-auto" onClick={onCash}><Receipt className="size-3.5" /> Ver caja</button>
          </div>
        )}
        {kitchenWork && (
          <>
            <Metric label="Platos preparados" value={r.itemsPrepared} />
            <Metric label="Hasta empezar" value={dur(r.avgStartSeconds)} />
            <Metric label="Hasta estar listo" value={dur(r.avgPrepSeconds)} />
            <Metric label="Fuera de tiempo" value={r.latePrepared} bad={r.latePrepared > 0} sub={`${DELAY_THRESHOLDS.kitchenSlow} min sobre su tiempo`} />
          </>
        )}
      </dl>
    </article>
  );
}

function Metric({ label, value, sub, bad }: { label: string; value: ReactNode; sub?: string; bad?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-[11px] font-semibold tracking-wide text-stone-400 uppercase">{label}</dt>
      <dd className={cx("font-display text-xl font-semibold tabular-nums", bad && "text-red-600")}>{value}</dd>
      {sub && <dd className="text-[11px] text-stone-500">{sub}</dd>}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <StaffShell>
      <Suspense>
        <Dashboard />
      </Suspense>
    </StaffShell>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import type { AvailabilityDTO, GuidelinesDTO, ReservationDTO, ReservationStatus } from "@resan/shared";
import { Ban, Bot, CalendarDays, Check, ChevronLeft, ChevronRight, Megaphone, Pencil, Phone, Plus, Search, StickyNote, UserX, Users, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useStaff } from "@/lib/staff-auth";
import { EmptyState, ErrorBanner, Sheet, Spinner, cx, useToast } from "@/components/ui";
import { StaffShell } from "../StaffShell";

const STATUS: Record<ReservationStatus, { label: string; chip: string }> = {
  confirmed: { label: "Confirmada", chip: "bg-sky-100 text-sky-800" },
  seated: { label: "Sentados", chip: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelada", chip: "bg-stone-100 text-stone-500 line-through" },
  no_show: { label: "No vino", chip: "bg-red-100 text-red-700" },
};

/** Fecha local de hoy (YYYY-MM-DD) en el navegador. */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
const pretty = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

type Draft = { id?: string; name: string; phone: string; partySize: number; date: string; time: string; notes: string };

function Reservations() {
  const { token, can } = useStaff();
  const [date, setDate] = useState(todayStr);
  const [data, setData] = useState<{ reservations: ReservationDTO[]; guidelines: GuidelinesDTO } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ReservationDTO[] | null>(null);
  const searching = q.trim().length >= 2;
  const toast = useToast();
  const manage = can("reservations.manage");

  const load = useCallback(async () => {
    try {
      setData(await api(`/staff/reservations?date=${date}`, { token }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [date, token]);
  const search = useCallback(async () => {
    if (q.trim().length < 2) return setFound(null);
    try {
      setFound(await api<ReservationDTO[]>(`/staff/reservations/search?q=${encodeURIComponent(q.trim())}`, { token }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [q, token]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const t = setTimeout(() => void search(), 250);
    return () => clearTimeout(t);
  }, [search]);
  useRealtime(token, (ev) => {
    if (!ev || ev.type === "reservation.updated" || ev.type === "resync" || ev.type === "reconnected") {
      void load();
      void search();
    }
  });

  const setStatus = async (r: ReservationDTO, status: ReservationStatus, ok: string) => {
    try {
      await api(`/staff/reservations/${r.id}`, { method: "PATCH", body: { status }, token });
      await load();
      await search();
      toast.show(ok);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const list = data?.reservations ?? [];
  const active = list.filter((r) => r.status === "confirmed" || r.status === "seated");
  const shown = showCancelled ? list : active;
  const covers = active.reduce((n, r) => n + r.partySize, 0);
  const g = data?.guidelines;
  const times = [...new Set(shown.map((r) => r.time))];
  const card = (r: ReservationDTO) => (
                <div className={cx("card flex flex-wrap items-center gap-3 p-4", (r.status === "cancelled" || r.status === "no_show") && "opacity-60")}>
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-stone-100 font-display text-xl font-semibold">
                    <span className="flex items-center gap-0.5"><Users className="size-4 text-stone-500" />{r.partySize}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-base">{r.name}</b>
                      <span className={cx("chip", STATUS[r.status].chip)}>{STATUS[r.status].label}</span>
                      {r.source === "n8n" && <span className="chip bg-violet-100 text-violet-800"><Bot className="size-3" /> Agente</span>}
                      <span className="text-xs text-stone-400">#{r.code}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-stone-500">
                      {r.phone && <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-ink"><Phone className="size-3.5" />{r.phone}</a>}
                      {r.tableLabel && <span>Mesa {r.tableLabel}</span>}
                    </div>
                    {r.notes && <p className="mt-1 flex items-start gap-1 text-sm text-amber-800"><StickyNote className="mt-0.5 size-3.5 shrink-0" />{r.notes}</p>}
                  </div>
                  {manage && (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {r.status === "confirmed" && (
                        <>
                          <button className="btn btn-ok btn-sm" onClick={() => setStatus(r, "seated", `${r.name}: sentados`)}><Check className="size-4" /> Han llegado</button>
                          <button className="btn btn-ghost btn-sm" title="No vino" onClick={() => setStatus(r, "no_show", "Marcada como no presentada")}><UserX className="size-4" /></button>
                        </>
                      )}
                      {r.status !== "cancelled" && (
                        <button className="btn btn-ghost btn-sm" title="Editar" onClick={() => setDraft({ id: r.id, name: r.name, phone: r.phone, partySize: r.partySize, date: r.date, time: r.time, notes: r.notes })}><Pencil className="size-4" /></button>
                      )}
                      {r.status === "confirmed" && (
                        <button className="btn btn-sm text-red-700 hover:bg-red-50" title="Cancelar" onClick={() => confirm(`¿Cancelar la reserva de ${r.name}?`) && setStatus(r, "cancelled", "Reserva cancelada")}><Ban className="size-4" /></button>
                      )}
                      {r.status !== "confirmed" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r, "confirmed", "Reserva reactivada")}>Deshacer</button>
                      )}
                    </div>
                  )}
                </div>
  );

  return (
    <div className="mx-auto max-w-4xl p-4">
      {toast.node}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl font-semibold">Reservas</h1>
        {manage && (
          <button className="btn btn-primary ml-auto" onClick={() => setDraft({ name: "", phone: "", partySize: 2, date, time: "", notes: "" })}>
            <Plus className="size-4" /> Nueva reserva
          </button>
        )}
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-stone-400" />
        <input className="input pl-10!" placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="absolute top-1/2 right-3 -translate-y-1/2 text-stone-400 hover:text-ink" onClick={() => setQ("")} aria-label="Borrar búsqueda"><X className="size-4" /></button>}
      </div>

      {searching ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-500">{found === null ? "Buscando…" : found.length === 0 ? "No hay reservas con ese nombre o teléfono." : `${found.length} ${found.length === 1 ? "reserva" : "reservas"}`}</p>
          {found?.map((r) => (
            <div key={r.id}>
              <span className="label capitalize">{pretty(r.date)} · {r.time}</span>
              {card(r)}
            </div>
          ))}
        </div>
      ) : (
      <>
      <div className="card mb-4 flex items-center gap-2 p-2">
        <button className="btn-icon hover:bg-stone-100" onClick={() => setDate((d) => shift(d, -1))} aria-label="Día anterior"><ChevronLeft className="size-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <b className="block font-display text-xl capitalize">{pretty(date)}</b>
          <span className="text-xs text-stone-500">{active.length} reservas · {covers} comensales</span>
        </div>
        {date !== todayStr() && <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayStr())}>Hoy</button>}
        <input type="date" className="input w-auto!" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn-icon hover:bg-stone-100" onClick={() => setDate((d) => shift(d, 1))} aria-label="Día siguiente"><ChevronRight className="size-5" /></button>
      </div>

      {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}

      {g && (!g.reservationsOpen || g.notes.length > 0) && (
        <div className={cx("mb-4 space-y-1.5 rounded-3xl p-4 ring-1", g.reservationsOpen ? "bg-amber-50 ring-amber-200" : "bg-red-50 ring-red-200")}>
          <b className="flex items-center gap-2 text-sm"><Megaphone className="size-4" /> {g.reservationsOpen ? "Pautas del día" : "Este día no se aceptan reservas"}</b>
          {g.notes.map((n) => (
            <p key={n.id} className="text-sm text-stone-700">• {n.text} {!n.date && <span className="text-xs text-stone-400">(siempre)</span>}</p>
          ))}
        </div>
      )}

      {!data && <div className="skeleton h-40" />}
      {data && shown.length === 0 && (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Sin reservas">
          {g?.reservationsOpen ? `Horario de reservas: ${g.hours || "—"}.` : "Las reservas de este día están cerradas."}
        </EmptyState>
      )}

      <div className="space-y-5">
        {times.map((time) => (
          <section key={time}>
            <h2 className="label">{time}</h2>
            <div className="space-y-2">
              {shown.filter((r) => r.time === time).map((r) => (
                <div key={r.id}>{card(r)}</div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {list.length > active.length && (
        <button className="mt-4 text-sm font-semibold text-stone-500 hover:text-ink" onClick={() => setShowCancelled((v) => !v)}>
          {showCancelled ? "Ocultar canceladas y no presentadas" : `Ver canceladas y no presentadas (${list.length - active.length})`}
        </button>
      )}
      </>
      )}

      {draft && <ReservationEditor draft={draft} onClose={() => setDraft(null)} onSaved={(d) => { setDraft(null); setDate(d); void load(); toast.show("Reserva guardada"); }} />}
    </div>
  );
}

function ReservationEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: (date: string) => void }) {
  const { token } = useStaff();
  const [d, setD] = useState(draft);
  const [av, setAv] = useState<AvailabilityDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!d.date || d.partySize < 1) return;
    api<AvailabilityDTO>(`/staff/reservations/availability?date=${d.date}&party=${d.partySize}`, { token }).then(setAv).catch(() => setAv(null));
  }, [d.date, d.partySize, token]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name: d.name, phone: d.phone, partySize: d.partySize, date: d.date, time: d.time, notes: d.notes };
      if (d.id) await api(`/staff/reservations/${d.id}`, { method: "PATCH", body, token });
      else await api("/staff/reservations", { body, token });
      onSaved(d.date);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const slot = av?.slots.find((s) => s.time === d.time);

  return (
    <Sheet open onClose={onClose} title={d.id ? "Editar reserva" : "Nueva reserva"}>
      <div className="space-y-4 px-5 pt-1 pb-6">
        <ErrorBanner>{error}</ErrorBanner>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2"><span className="label">Nombre</span><input className="input" value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
          <label><span className="label">Teléfono</span><input className="input" inputMode="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} /></label>
          <label><span className="label">Personas</span><input className="input" type="number" min={1} max={200} value={d.partySize} onChange={(e) => set("partySize", Math.max(1, Number(e.target.value) || 1))} /></label>
          <label><span className="label">Día</span><input className="input" type="date" value={d.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label><span className="label">Hora</span><input className="input" type="time" step={300} value={d.time} onChange={(e) => set("time", e.target.value)} /></label>
        </div>
        {av && (
          <div>
            {!av.open ? (
              <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{av.reason} Puedes apuntarla igualmente.</p>
            ) : (
              <>
                <span className="label">Huecos para {av.partySize}</span>
                <div className="flex flex-wrap gap-1.5">
                  {av.slots.map((s) => (
                    <button
                      key={s.time}
                      onClick={() => set("time", s.time)}
                      className={cx(
                        "rounded-xl px-3 py-1.5 text-sm font-semibold ring-1 transition",
                        d.time === s.time ? "bg-ink text-white ring-ink" : s.available ? "bg-white ring-stone-200 hover:ring-stone-400" : "bg-stone-50 text-stone-400 line-through ring-stone-100",
                      )}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
                {slot && !slot.available && <p className="mt-2 text-xs text-amber-700">A esa hora está completo ({slot.remainingCovers} plazas libres). Se apuntará igualmente.</p>}
              </>
            )}
          </div>
        )}
        <label className="block"><span className="label">Notas</span><textarea className="input min-h-20" value={d.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Cumpleaños, trona, alergias…" /></label>
        <button className="btn btn-primary btn-lg w-full" disabled={busy || !d.name.trim() || !d.time || !d.date} onClick={save}>{busy ? <Spinner /> : "Guardar reserva"}</button>
      </div>
    </Sheet>
  );
}

export default function ReservationsPage() {
  return (
    <StaffShell>
      <Reservations />
    </StaffShell>
  );
}

"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  LANGUAGES,
  LANGUAGE_NAMES,
  ROLES,
  TAGS,
  TAG_LABELS,
  WEEKDAYS,
  formatMoney,
  type AdminCategoryDTO,
  type AdminItemDTO,
  type FloorTasksDTO,
  type Allergen,
  type Language,
  type StaffMeDTO,
  type StaffTableDTO,
  type ReservationSettings,
  type Tag,
  type VenueNoteDTO,
  type Weekday,
} from "@resan/shared";
import {
  BellRing,
  BookOpen,
  Bot,
  CalendarDays,
  Copy,
  Megaphone,
  ChevronDown,
  ChevronUp,
  ChefHat,
  Eye,
  EyeOff,
  ExternalLink,
  GlassWater,
  KeyRound,
  LayoutGrid,
  MapPin,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Sparkles,
  Store,
  Timer,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { API_URL, api, errorText } from "@/lib/api";
import { useStaff } from "@/lib/staff-auth";
import { ALLERGEN_ICON, TAG_STYLE } from "@/lib/visual";
import { MenuImage } from "@/components/MenuImage";
import { Avatar, EmptyState, ErrorBanner, Sheet, Switch, cx, useToast } from "@/components/ui";
import { ROLE_LABEL, StaffShell } from "../StaffShell";

type Tab = "menu" | "tables" | "team" | "reservations" | "settings";

function Admin() {
  const { can } = useStaff();
  const tabs = [
    can("menu.edit") && { id: "menu", label: "Carta", icon: BookOpen },
    can("tables.manage") && { id: "tables", label: "Mesas y QR", icon: QrCode },
    can("users.manage") && { id: "team", label: "Equipo", icon: Users },
    can("service.settings") && { id: "reservations", label: "Reservas", icon: CalendarDays },
    can("venue.settings") && { id: "settings", label: "Local y módulos", icon: Store },
  ].filter(Boolean) as { id: Tab; label: string; icon: typeof Users }[];
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "menu");
  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="no-print mb-6">
        <h1 className="font-display text-4xl font-semibold">Gestión</h1>
        <div className="scrollbar-none mt-4 flex gap-1 overflow-x-auto border-b border-stone-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition",
                tab === t.id ? "border-brand-600 text-ink" : "border-transparent text-stone-500 hover:text-ink",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>
      <div key={tab} className="animate-fade-up">
        {tab === "menu" && <MenuTab />}
        {tab === "tables" && <TablesTab />}
        {tab === "team" && <TeamTab />}
        {tab === "reservations" && <ReservationsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}

function useErr() {
  const [error, setError] = useState<string | null>(null);
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return { error, wrap, node: error ? <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div> : null };
}

// ---------------- Carta ----------------
function MenuTab() {
  const { token, me, can } = useStaff();
  const [cats, setCats] = useState<AdminCategoryDTO[] | null>(null);
  const [editing, setEditing] = useState<Partial<AdminItemDTO> | null>(null);
  const [newCat, setNewCat] = useState("");
  const [renaming, setRenaming] = useState<AdminCategoryDTO | null>(null);
  const { wrap, node } = useErr();
  const load = useCallback(async () => setCats(await api<AdminCategoryDTO[]>("/staff/menu", { token })), [token]);
  /** Mueve un elemento una posición arriba o abajo y guarda el nuevo orden. */
  const move = (kind: "category" | "item", ids: string[], index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[index], next[j]] = [next[j]!, next[index]!];
    void wrap(async () => {
      await api("/staff/menu/reorder", { body: { kind, ids: next }, token });
      await load();
    });
  };
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = me.defaultLanguage;
  const money = (c: number) => formatMoney(c, def);
  const [prepDefault, setPrepDefault] = useState(me.defaultPrepMinutes);
  const [prepInput, setPrepInput] = useState(String(me.defaultPrepMinutes));

  return (
    <div>
      {node}
      {can("service.settings") && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
          <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><Timer className="size-5" /></span>
          <div className="min-w-0 flex-1 text-sm">
            <b className="block">Cocina automática</b>
            <span className="text-stone-500">Los platos pasan solos a «listo» al cumplir su tiempo. Pon el tiempo de cada plato al editarlo; si no tiene, usa este:</span>
          </div>
          <span className="flex items-center gap-2">
            <input className="input w-20!" inputMode="numeric" value={prepInput} onChange={(e) => setPrepInput(e.target.value.replace(/\D/g, ""))} />
            <span className="text-sm text-stone-500">min</span>
            <button
              className="btn btn-dark btn-sm"
              disabled={!Number(prepInput) || Number(prepInput) === prepDefault}
              onClick={() => wrap(async () => {
                const m = await api<StaffMeDTO>("/staff/venue/service", { method: "PATCH", body: { defaultPrepMinutes: Math.min(240, Number(prepInput)) }, token });
                setPrepDefault(m.defaultPrepMinutes);
                setPrepInput(String(m.defaultPrepMinutes));
              })}
            >
              Guardar
            </button>
          </span>
        </div>
      )}
      <form
        className="card mb-6 flex gap-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newCat.trim()) return;
          void wrap(async () => {
            await api("/staff/categories", { body: { translations: { [def]: { name: newCat.trim() } } }, token });
            setNewCat("");
            await load();
          });
        }}
      >
        <input className="input border-transparent! shadow-none!" placeholder={`Nueva categoría (${LANGUAGE_NAMES[def]})`} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        <button className="btn btn-dark" disabled={!newCat.trim()}><Plus className="size-4" /> Categoría</button>
      </form>
      {!cats && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20" />)}</div>}
      {cats?.length === 0 && (
        <div className="space-y-4">
          <EmptyState icon={<BookOpen className="size-6" />} title="Tu carta está vacía">Crea la primera categoría (Entrantes, Bebidas…).</EmptyState>
          <SampleDataCard />
        </div>
      )}
      {cats?.map((c, ci) => (
        <section key={c.id} className="mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
              <span className="flex flex-col">
                <button className="text-stone-300 hover:text-ink disabled:opacity-20" disabled={ci === 0} onClick={() => move("category", cats.map((x) => x.id), ci, -1)} aria-label="Subir"><ChevronUp className="size-4" /></button>
                <button className="text-stone-300 hover:text-ink disabled:opacity-20" disabled={ci === cats.length - 1} onClick={() => move("category", cats.map((x) => x.id), ci, 1)} aria-label="Bajar"><ChevronDown className="size-4" /></button>
              </span>
              {c.translations[def]?.name ?? "(sin nombre)"}
              <span className="text-sm font-normal text-stone-400">{c.items.length}</span>
              {!c.active && <span className="chip">oculta</span>}
            </h2>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => wrap(async () => { await api(`/staff/categories/${c.id}`, { method: "PATCH", body: { active: !c.active }, token }); await load(); })}>
                {c.active ? <><EyeOff className="size-3.5" /> Ocultar</> : <><Eye className="size-3.5" /> Mostrar</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(c)}><Pencil className="size-3.5" /> Renombrar</button>
              <button
                className="btn btn-ghost btn-sm text-red-700!"
                onClick={() => {
                  const msg = c.items.length ? `¿Eliminar «${c.translations[def]?.name}» y sus ${c.items.length} platos? Los pedidos ya hechos no se ven afectados.` : `¿Eliminar «${c.translations[def]?.name}»?`;
                  if (confirm(msg)) void wrap(async () => { await api(`/staff/categories/${c.id}`, { method: "DELETE", token }); await load(); });
                }}
              >
                <Trash2 className="size-3.5" /> Eliminar
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setEditing({ categoryId: c.id, fulfillment: "kitchen", allergens: [], tags: [], translations: {}, priceCents: 0 })}><Plus className="size-3.5" /> Plato</button>
            </div>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {c.items.length === 0 && <li className="rounded-2xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500 sm:col-span-2">Sin platos. Añade uno con «Plato».</li>}
            {c.items.map((i, ii) => (
              <li key={i.id} className={cx("card card-hover flex items-center gap-3 p-2.5", !i.active && "opacity-50")}>
                <span className="flex flex-col">
                  <button className="text-stone-300 hover:text-ink disabled:opacity-20" disabled={ii === 0} onClick={() => move("item", c.items.map((x) => x.id), ii, -1)} aria-label="Subir"><ChevronUp className="size-4" /></button>
                  <button className="text-stone-300 hover:text-ink disabled:opacity-20" disabled={ii === c.items.length - 1} onClick={() => move("item", c.items.map((x) => x.id), ii, 1)} aria-label="Bajar"><ChevronDown className="size-4" /></button>
                </span>
                <MenuImage src={i.imageUrl} alt="" className="size-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{i.translations[def]?.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                    <b className="text-sm text-ink tabular-nums">{money(i.priceCents)}</b>
                    <span className="flex items-center gap-0.5">{i.fulfillment === "kitchen" ? <ChefHat className="size-3" /> : <GlassWater className="size-3" />}{i.fulfillment === "kitchen" ? "Cocina" : "Sala"}</span>
                    {i.fulfillment === "kitchen" && <span className="flex items-center gap-0.5"><Timer className="size-3" />{i.prepMinutes ?? prepDefault}′</span>}
                    <span>{Object.keys(i.translations).length}/{me.languages.length} idiomas</span>
                  </div>
                </div>
                <button
                  className={cx("chip shrink-0 px-2.5! py-1! ring-1 transition", i.available ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200")}
                  onClick={() => wrap(async () => { await api(`/staff/items/${i.id}/availability`, { method: "PATCH", body: { available: !i.available }, token }); await load(); })}
                >
                  <span className={cx("size-1.5 rounded-full", i.available ? "bg-emerald-500" : "bg-red-500")} />
                  {i.available ? "Disponible" : "Agotado"}
                </button>
                <button className="btn-icon shrink-0 text-stone-500 hover:bg-stone-100" onClick={() => setEditing(i)} aria-label="Editar"><Pencil className="size-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Sheet open={!!renaming} onClose={() => setRenaming(null)} title="Nombre de la categoría">
        {renaming && <CategoryEditor cat={renaming} me={me} onClose={() => setRenaming(null)} onSaved={async () => { setRenaming(null); await load(); }} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} wide title={editing?.id ? "Editar plato" : "Nuevo plato"}>
        {editing && <ItemEditor item={editing} me={me} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      </Sheet>
    </div>
  );
}

function CategoryEditor({ cat, me, onClose, onSaved }: { cat: AdminCategoryDTO; me: StaffMeDTO; onClose: () => void; onSaved: () => void }) {
  const { token } = useStaff();
  const { wrap, node } = useErr();
  const [names, setNames] = useState<Partial<Record<Language, string>>>(Object.fromEntries(me.languages.map((l) => [l, cat.translations[l]?.name ?? ""])));
  const save = () => wrap(async () => {
    const translations = Object.fromEntries(Object.entries(names).filter(([, v]) => v?.trim()).map(([l, v]) => [l, { name: v!.trim() }]));
    await api(`/staff/categories/${cat.id}`, { method: "PATCH", body: { translations }, token });
    onSaved();
  });
  return (
    <div className="space-y-3 px-5 pt-2 pb-6">
      {node}
      {me.languages.map((l) => (
        <label key={l} className="block">
          <span className="label">{LANGUAGE_NAMES[l]}{l === me.defaultLanguage && " (obligatorio)"}</span>
          <input className="input" value={names[l] ?? ""} onChange={(e) => setNames({ ...names, [l]: e.target.value })} />
        </label>
      ))}
      <div className="flex gap-2 pt-2">
        <button className="btn btn-ghost flex-1" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary flex-1" disabled={!names[me.defaultLanguage]?.trim()} onClick={save}>Guardar</button>
      </div>
    </div>
  );
}

function ItemEditor({ item, me, onClose, onSaved }: { item: Partial<AdminItemDTO>; me: StaffMeDTO; onClose: () => void; onSaved: () => void }) {
  const { token } = useStaff();
  const { wrap, node } = useErr();
  const [lang, setLang] = useState<Language>(me.defaultLanguage);
  const [f, setF] = useState({
    translations: item.translations ?? {},
    price: ((item.priceCents ?? 0) / 100).toFixed(2),
    fulfillment: item.fulfillment ?? "kitchen",
    prep: item.prepMinutes ? String(item.prepMinutes) : "",
    allergens: (item.allergens ?? []) as Allergen[],
    tags: (item.tags ?? []) as Tag[],
    imageUrl: item.imageUrl ?? "",
    active: item.active ?? true,
  });
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const setTr = (l: Language, k: "name" | "description", v: string) =>
    setF((s) => ({ ...s, translations: { ...s.translations, [l]: { name: s.translations[l]?.name ?? "", description: s.translations[l]?.description ?? "", [k]: v } } }));

  const save = () => wrap(async () => {
    const translations = Object.fromEntries(
      Object.entries(f.translations).filter(([, v]) => v && v.name.trim()).map(([l, v]) => [l, { name: v.name.trim(), description: v.description?.trim() ?? "" }]),
    );
    const body = {
      categoryId: item.categoryId,
      priceCents: Math.round(parseFloat(f.price.replace(",", ".")) * 100),
      fulfillment: f.fulfillment,
      prepMinutes: f.fulfillment === "kitchen" && Number(f.prep) > 0 ? Math.min(240, Math.round(Number(f.prep))) : null,
      allergens: f.allergens,
      tags: f.tags,
      imageUrl: f.imageUrl.trim() || null,
      translations,
      ...(item.id ? { active: f.active } : {}),
    };
    if (item.id) await api(`/staff/items/${item.id}`, { method: "PATCH", body, token });
    else await api("/staff/items", { body, token });
    onSaved();
  });

  return (
    <div className="px-5 pt-2 pb-5">
      {node}
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
        <div>
          <MenuImage src={f.imageUrl.trim() || null} alt="" className="aspect-square w-full rounded-2xl" />
          <input className="input mt-2 text-xs!" placeholder="URL de imagen" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />
        </div>
        <div className="space-y-3">
          <div className="scrollbar-none flex gap-1 overflow-x-auto">
            {me.languages.map((l) => {
              const filled = !!f.translations[l]?.name?.trim();
              return (
                <button key={l} type="button" onClick={() => setLang(l)} className={cx("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase transition", lang === l ? "bg-ink text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200")}>
                  <span className={cx("size-1.5 rounded-full", filled ? "bg-emerald-400" : l === me.defaultLanguage ? "bg-red-400" : "bg-stone-300")} />
                  {l}
                </button>
              );
            })}
          </div>
          <label className="block">
            <span className="label">Nombre · {LANGUAGE_NAMES[lang]}{lang === me.defaultLanguage && " (obligatorio)"}</span>
            <input className="input" value={f.translations[lang]?.name ?? ""} onChange={(e) => setTr(lang, "name", e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Descripción</span>
            <textarea className="input" rows={3} value={f.translations[lang]?.description ?? ""} onChange={(e) => setTr(lang, "description", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Precio (€ IVA incl.)</span><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
            <div>
              <span className="label">Destino</span>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
                {([["kitchen", "Cocina", ChefHat], ["serve", "Sala", GlassWater]] as const).map(([v, label, Icon]) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, fulfillment: v })} className={cx("flex items-center justify-center gap-1 rounded-lg py-1.5 text-sm font-semibold transition", f.fulfillment === v ? "bg-white shadow-soft" : "text-stone-500")}>
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-stone-500">{f.fulfillment === "kitchen" ? "Aparece en la pantalla de cocina y pasa solo a «listo» cuando se cumple su tiempo." : "Bebidas, postres o cafés: van directos a la lista de sala, sin pasar por cocina."}</p>
          {f.fulfillment === "kitchen" && (
            <label className="flex items-center gap-3">
              <span className="label mb-0!">Tiempo de cocina</span>
              <input className="input w-24!" inputMode="numeric" placeholder={String(me.defaultPrepMinutes)} value={f.prep} onChange={(e) => setF({ ...f, prep: e.target.value.replace(/\D/g, "") })} />
              <span className="text-sm text-stone-500">min {!f.prep && <span className="text-stone-400">(por defecto, {me.defaultPrepMinutes})</span>}</span>
            </label>
          )}
        </div>
      </div>
      <fieldset className="mt-5">
        <legend className="label">Alérgenos</legend>
        <div className="flex flex-wrap gap-1.5">
          {ALLERGENS.map((a) => (
            <button type="button" key={a} onClick={() => setF({ ...f, allergens: toggle(f.allergens, a) })} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition active:scale-95", f.allergens.includes(a) ? "bg-red-50 text-red-800 ring-red-300" : "bg-white text-stone-600 ring-stone-200 hover:ring-stone-300")}>
              {ALLERGEN_ICON[a]} {ALLERGEN_LABELS[me.defaultLanguage][a]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="label">Etiquetas</legend>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button type="button" key={t} onClick={() => setF({ ...f, tags: toggle(f.tags, t) })} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition active:scale-95", f.tags.includes(t) ? TAG_STYLE[t].cls : "bg-white text-stone-600 ring-stone-200 hover:ring-stone-300")}>
              {TAG_STYLE[t].icon} {TAG_LABELS[me.defaultLanguage][t]}
            </button>
          ))}
        </div>
      </fieldset>
      {item.id && <div className="mt-4"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Visible en la carta" hint="Si lo ocultas, no aparece a los comensales." /></div>}
      <div className="sticky bottom-0 -mx-5 mt-5 flex gap-2 border-t border-stone-100 bg-white px-5 pt-4">
        {item.id && (
          <button
            className="btn text-red-700 hover:bg-red-50"
            onClick={() => {
              if (confirm("¿Eliminar este plato de la carta? Los pedidos ya hechos no se ven afectados.")) {
                void wrap(async () => { await api(`/staff/items/${item.id}`, { method: "DELETE", token }); onSaved(); });
              }
            }}
          >
            <Trash2 className="size-4" /> Eliminar
          </button>
        )}
        <button className="btn btn-ghost flex-1" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary flex-1" onClick={save}>Guardar</button>
      </div>
    </div>
  );
}

// ---------------- Mesas y QR ----------------
function TablesTab() {
  const { token, me } = useStaff();
  const [tables, setTables] = useState<StaffTableDTO[] | null>(null);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [zone, setZone] = useState("");
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [newZone, setNewZone] = useState("");
  const [editingTable, setEditingTable] = useState<StaffTableDTO | null>(null);
  const [tf, setTf] = useState({ label: "", zoneId: "", capacity: "4" });
  const { wrap, node } = useErr();
  const startEdit = (t: StaffTableDTO) => {
    setTf({ label: t.label, zoneId: t.zoneId ?? "", capacity: String(t.capacity) });
    setEditingTable(t);
  };

  const load = useCallback(async () => {
    const [t, z] = await Promise.all([api<StaffTableDTO[]>("/staff/tables", { token }), api<{ id: string; name: string }[]>("/staff/zones", { token })]);
    setTables(t);
    setZones(z);
    const next: Record<string, string> = {};
    for (const x of t) next[x.id] = await QRCode.toDataURL(`${window.location.origin}/q/${x.qrToken}`, { margin: 1, width: 360, color: { dark: "#1c1712", light: "#ffffff" } });
    setQrs(next);
  }, [token]);
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="no-print">
        {node}
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <form className="card space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); if (label.trim()) void wrap(async () => { await api("/staff/tables", { body: { label: label.trim(), zoneId: zone || null }, token }); setLabel(""); await load(); }); }}>
            <h3 className="flex items-center gap-2 font-semibold"><LayoutGrid className="size-4" /> Nueva mesa</h3>
            <div className="flex gap-2">
              <input className="input" placeholder="Etiqueta (ej. 7)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <select className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">Sin zona</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <button className="btn btn-dark" disabled={!label.trim()}><Plus className="size-4" /></button>
            </div>
          </form>
          <form className="card space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); if (newZone.trim()) void wrap(async () => { await api("/staff/zones", { body: { name: newZone.trim() }, token }); setNewZone(""); await load(); }); }}>
            <h3 className="font-semibold">Nueva zona</h3>
            <div className="flex gap-2">
              <input className="input" placeholder="Terraza, Salón…" value={newZone} onChange={(e) => setNewZone(e.target.value)} />
              <button className="btn btn-ghost" disabled={!newZone.trim()}><Plus className="size-4" /></button>
            </div>
          </form>
        </div>
        {zones.length > 0 && <ZonesCard zones={zones} tables={tables ?? []} onChanged={() => wrap(load)} />}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-stone-500">{tables?.length ?? 0} mesas · cada QR abre la carta de su mesa.</p>
          <button className="btn btn-primary" onClick={() => window.print()}><Printer className="size-4" /> Imprimir todos</button>
        </div>
      </div>
      {!tables && <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton aspect-[3/4]" />)}</div>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-6">
        {tables?.map((t) => (
          <div key={t.id} className="card group relative break-inside-avoid overflow-hidden text-center print:border-2 print:border-stone-300">
            <div className="relative bg-ink px-4 py-3 text-white print:bg-white print:text-ink">
              <div className="no-print absolute top-2 right-2 flex gap-1">
                <button className="btn-icon size-8! text-white/60 hover:bg-white/10 hover:text-white" aria-label="Editar mesa" onClick={() => startEdit(t)}><Pencil className="size-4" /></button>
                <button className="btn-icon size-8! text-white/60 hover:bg-red-500/30 hover:text-white" aria-label="Eliminar mesa"
                  onClick={() => { if (confirm(`¿Eliminar la mesa ${t.label}? Su QR dejará de funcionar. El historial de pedidos se conserva.`)) void wrap(async () => { await api(`/staff/tables/${t.id}`, { method: "DELETE", token }); await load(); }); }}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="text-xs tracking-[0.2em] text-white/60 uppercase print:text-stone-500">{me.venueName}</div>
              <div className="font-display text-3xl font-semibold">Mesa {t.label}</div>
            </div>
            <div className="p-4">
              {qrs[t.id] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={qrs[t.id]} alt={`QR mesa ${t.label}`} className="mx-auto w-full max-w-44 rounded-xl" />
              ) : (
                <div className="skeleton mx-auto aspect-square max-w-44" />
              )}
              <div className="mt-3 text-sm font-semibold">Escanea para ver la carta y pedir</div>
              <div className="text-xs text-stone-400">{t.zoneName ?? "Sin zona"} · {t.capacity} plazas</div>
              <a className="no-print btn btn-ghost btn-sm mt-3 mr-1.5" href={`/q/${t.qrToken}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> Abrir carta
              </a>
              <button
                className="no-print btn btn-soft btn-sm mt-3"
                onClick={() => { if (confirm("El QR actual dejará de funcionar. ¿Regenerar?")) void wrap(async () => { await api(`/staff/tables/${t.id}/regenerate-qr`, { body: {}, token }); await load(); }); }}
              >
                <RefreshCw className="size-3.5" /> Regenerar QR
              </button>
            </div>
          </div>
        ))}
      </div>
      <Sheet open={!!editingTable} onClose={() => setEditingTable(null)} title={`Mesa ${editingTable?.label ?? ""}`}>
        <form
          className="space-y-3 px-5 pt-2 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            const t = editingTable!;
            void wrap(async () => {
              await api(`/staff/tables/${t.id}`, { method: "PATCH", body: { label: tf.label.trim(), zoneId: tf.zoneId || null, capacity: Math.max(1, parseInt(tf.capacity) || 1) }, token });
              setEditingTable(null);
              await load();
            });
          }}
        >
          {node}
          <label className="block"><span className="label">Nombre o número</span><input className="input" value={tf.label} onChange={(e) => setTf({ ...tf, label: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label">Zona</span>
              <select className="input" value={tf.zoneId} onChange={(e) => setTf({ ...tf, zoneId: e.target.value })}>
                <option value="">Sin zona</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Plazas</span><input className="input" inputMode="numeric" value={tf.capacity} onChange={(e) => setTf({ ...tf, capacity: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <button className="btn btn-primary btn-lg w-full" disabled={!tf.label.trim()}>Guardar</button>
        </form>
      </Sheet>
    </div>
  );
}

/** Zonas, sus camareros y si las mesas se reparten por zonas. */
function ZonesCard({ zones, tables, onChanged }: { zones: { id: string; name: string }[]; tables: StaffTableDTO[]; onChanged: () => void }) {
  const { token, me, can } = useStaff();
  const [floor, setFloor] = useState<FloorTasksDTO | null>(null);
  const [byZone, setByZone] = useState(me.assignByZone);
  const { wrap, node } = useErr();
  const load = useCallback(async () => setFloor(await api<FloorTasksDTO>("/staff/floor/tasks", { token })), [token]);
  useEffect(() => void wrap(load), [load, zones]); // eslint-disable-line react-hooks/exhaustive-deps
  const staffOf = (zoneId: string) => floor?.zones.find((z) => z.id === zoneId)?.staff.map((s) => s.userId) ?? [];
  const toggleWaiter = (zoneId: string, userId: string) => wrap(async () => {
    const cur = staffOf(zoneId);
    const userIds = cur.includes(userId) ? cur.filter((u) => u !== userId) : [...cur, userId];
    await api(`/staff/zones/${zoneId}/staff`, { method: "PUT", body: { userIds }, token });
    await load();
  });
  return (
    <div className="card mb-6 p-4">
      {node}
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-semibold"><MapPin className="size-4" /> Zonas y camareros</h3>
          <p className="text-sm text-stone-500">Marca qué camareros llevan cada zona.</p>
        </div>
        {can("service.settings") && (
          <div className="w-full sm:w-80">
            <Switch
              checked={byZone}
              onChange={(v) => wrap(async () => { const m = await api<StaffMeDTO>("/staff/venue/service", { method: "PATCH", body: { assignByZone: v }, token }); setByZone(m.assignByZone); })}
              label="Asignar mesas por zonas"
              hint={byZone ? "Cuando un cliente abre una mesa, va directa al camarero conectado de su zona (al que menos mesas lleve)." : "Desactivado: las mesas se ofrecen a los camareros menos ocupados y se asignan solas a los 5 min."}
            />
          </div>
        )}
      </div>
      <div className="divide-y divide-stone-100">
        {zones.map((z) => (
          <div key={z.id} className="flex flex-wrap items-center gap-2 py-3">
            <b className="min-w-28">{z.name} <span className="text-xs font-normal text-stone-400">· {tables.filter((t) => t.zoneId === z.id).length} mesas</span></b>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {floor?.waiters.length === 0 && <span className="text-sm text-stone-400">Añade camareros en «Equipo».</span>}
              {floor?.waiters.map((w) => {
                const on = staffOf(z.id).includes(w.userId);
                return (
                  <button key={w.userId} onClick={() => toggleWaiter(z.id, w.userId)}
                    className={cx("flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-semibold ring-1 transition active:scale-95", on ? "bg-sky-600 text-white ring-sky-600" : "bg-white text-stone-600 ring-stone-200 hover:ring-stone-300")}>
                    <Avatar name={w.name} className="size-6! text-[10px]!" /> {w.name}
                  </button>
                );
              })}
            </div>
            <button className="btn-icon size-8! text-stone-400 hover:bg-stone-100 hover:text-ink" aria-label="Renombrar zona"
              onClick={() => { const name = prompt("Nuevo nombre de la zona", z.name); if (name?.trim()) void wrap(async () => { await api(`/staff/zones/${z.id}`, { method: "PATCH", body: { name: name.trim() }, token }); onChanged(); }); }}>
              <Pencil className="size-3.5" />
            </button>
            <button className="btn-icon size-8! text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar zona"
              onClick={() => { if (confirm(`¿Eliminar la zona «${z.name}»? Sus mesas quedarán sin zona.`)) void wrap(async () => { await api(`/staff/zones/${z.id}`, { method: "DELETE", token }); onChanged(); }); }}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Equipo ----------------
interface Member { membershipId: string; userId: string; email: string; name: string; role: (typeof ROLES)[number]; hasPin: boolean }
const ROLE_CHIP: Record<Member["role"], string> = {
  owner: "bg-violet-50 text-violet-700 ring-violet-200",
  manager: "bg-sky-50 text-sky-700 ring-sky-200",
  waiter: "bg-brand-50 text-brand-700 ring-brand-200",
  kitchen: "bg-amber-50 text-amber-800 ring-amber-200",
};
function TeamTab() {
  const { token, me } = useStaff();
  const [users, setUsers] = useState<Member[] | null>(null);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "waiter" as Member["role"], pin: "" });
  const [pinFor, setPinFor] = useState<Member | null>(null);
  const [pin, setPin] = useState("");
  const [editingUser, setEditingUser] = useState<Member | null>(null);
  const [uf, setUf] = useState({ name: "", email: "", password: "" });
  const [adding, setAdding] = useState(false);
  const { wrap, node } = useErr();
  const toast = useToast();
  const load = useCallback(async () => setUsers(await api<Member[]>("/staff/users", { token })), [token]);
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const roles: readonly Member["role"][] = me.role === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");
  return (
    <div>
      {toast.node}
      {node}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-stone-500">Sala y cocina entran con el local <code className="rounded bg-stone-100 px-1.5 py-0.5 font-semibold text-ink">{me.venueSlug}</code> y su PIN; gestión con correo y contraseña.</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><UserPlus className="size-4" /> Añadir persona</button>
      </div>
      {!users && <div className="skeleton h-40" />}
      <ul className="card divide-y divide-stone-100">
        {users?.map((u) => (
          <li key={u.membershipId} className="flex flex-wrap items-center gap-3 p-3.5">
            <Avatar name={u.name} className="size-11" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><b className="truncate">{u.name}</b>{u.userId === me.userId && <span className="chip">tú</span>}</div>
              <div className="truncate text-sm text-stone-500">{u.email}</div>
            </div>
            <span className={cx("chip ring-1", u.hasPin ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "ring-stone-200")}><KeyRound className="size-3" /> {u.hasPin ? "PIN" : "Sin PIN"}</span>
            <select
              className={cx("rounded-full border-0 px-3 py-1.5 text-xs font-semibold ring-1", ROLE_CHIP[u.role])}
              value={u.role}
              disabled={u.userId === me.userId}
              onChange={(e) => wrap(async () => { await api(`/staff/users/${u.membershipId}`, { method: "PATCH", body: { role: e.target.value }, token }); await load(); })}
            >
              {ROLES.map((r) => <option key={r} value={r} disabled={!roles.includes(r)}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => { setUf({ name: u.name, email: u.email, password: "" }); setEditingUser(u); }}><Pencil className="size-3.5" /> Editar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPin(""); setPinFor(u); }}><KeyRound className="size-3.5" /> PIN</button>
            {u.userId !== me.userId && (
              <button className="btn-icon text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar" onClick={() => { if (confirm(`¿Quitar a ${u.name}?`)) void wrap(async () => { await api(`/staff/users/${u.membershipId}`, { method: "DELETE", token }); await load(); }); }}>
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Sheet open={!!editingUser} onClose={() => setEditingUser(null)} title={`Editar a ${editingUser?.name ?? ""}`}>
        <form
          className="space-y-3 px-5 pt-2 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            const u = editingUser!;
            const body: Record<string, string> = {};
            if (uf.name.trim() && uf.name.trim() !== u.name) body.name = uf.name.trim();
            if (uf.email.trim() && uf.email.trim().toLowerCase() !== u.email) body.email = uf.email.trim();
            if (uf.password) body.password = uf.password;
            if (!Object.keys(body).length) return setEditingUser(null);
            void wrap(async () => {
              await api(`/staff/users/${u.membershipId}`, { method: "PATCH", body, token });
              setEditingUser(null);
              toast.show("Datos actualizados");
              await load();
            });
          }}
        >
          {node}
          <label className="block"><span className="label">Nombre</span><input className="input" value={uf.name} onChange={(e) => setUf({ ...uf, name: e.target.value })} /></label>
          <label className="block"><span className="label">Correo</span><input className="input" type="email" value={uf.email} onChange={(e) => setUf({ ...uf, email: e.target.value })} /></label>
          <label className="block"><span className="label">Nueva contraseña</span><input className="input" type="password" placeholder="Déjala vacía para no cambiarla" value={uf.password} onChange={(e) => setUf({ ...uf, password: e.target.value })} /></label>
          {uf.password && uf.password.length < 8 && <p className="text-xs text-amber-700">Mínimo 8 caracteres.</p>}
          <button className="btn btn-primary btn-lg w-full" disabled={!!uf.password && uf.password.length < 8}>Guardar</button>
        </form>
      </Sheet>

      <Sheet open={!!pinFor} onClose={() => setPinFor(null)} title={`PIN de ${pinFor?.name ?? ""}`}>
        <form className="space-y-3 px-5 pt-2 pb-6" onSubmit={(e) => { e.preventDefault(); const u = pinFor!; void wrap(async () => { await api(`/staff/users/${u.membershipId}`, { method: "PATCH", body: { pin: pin || null }, token }); setPinFor(null); toast.show(pin ? "PIN actualizado" : "PIN eliminado"); await load(); }); }}>
          <p className="text-sm text-stone-500">De 4 a 8 dígitos, único en el local. Déjalo vacío para quitarlo.</p>
          <input className="input text-center font-display text-3xl! tracking-[.5em]" inputMode="numeric" maxLength={8} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          <button className="btn btn-primary btn-lg w-full" disabled={pin.length > 0 && pin.length < 4}>{pin ? "Guardar PIN" : "Quitar PIN"}</button>
        </form>
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Añadir persona">
        <form className="space-y-3 px-5 pt-2 pb-6" onSubmit={(e) => { e.preventDefault(); void wrap(async () => {
          await api("/staff/users", { body: { ...f, pin: f.pin || undefined }, token });
          setF({ name: "", email: "", password: "", role: "waiter", pin: "" });
          setAdding(false);
          toast.show("Persona añadida");
          await load();
        }); }}>
          <label className="block"><span className="label">Nombre</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="block"><span className="label">Correo</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label">Contraseña</span><input className="input" placeholder="mín. 8" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
            <label className="block"><span className="label">PIN (opcional)</span><input className="input" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <div>
            <span className="label">Rol</span>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((r) => (
                <button type="button" key={r} onClick={() => setF({ ...f, role: r })} className={cx("rounded-2xl px-3 py-2.5 text-sm font-semibold ring-1 transition", f.role === r ? "bg-ink text-white ring-ink" : "bg-white ring-stone-200 hover:ring-stone-300")}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
          {node}
          <button className="btn btn-primary btn-lg w-full">Crear</button>
        </form>
      </Sheet>
    </div>
  );
}

// ---------------- Datos de ejemplo ----------------
/** Rellena un local vacío con carta, mesas, equipo y servicio en marcha para hacer una demo. */
function SampleDataCard() {
  const { token, can } = useStaff();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ tables: number; items: number; staff: { name: string; pin: string }[] } | null>(null);
  const { wrap, node } = useErr();
  if (!can("venue.settings")) return null;
  const load = () => {
    if (!confirm("Se añadirán una carta, 9 mesas y un equipo de prueba. ¿Continuar?")) return;
    setBusy(true);
    void wrap(async () => {
      setDone(await api("/staff/venue/sample-data", { body: {}, token }));
    }).finally(() => setBusy(false));
  };
  return (
    <section className="card overflow-hidden">
      <div className="flex items-start gap-3 bg-gradient-to-br from-brand-50 to-white p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-soft"><Sparkles className="size-5" /></span>
        <div>
          <h3 className="font-display text-xl font-semibold">Datos de ejemplo</h3>
          <p className="text-sm text-stone-600">Para enseñar la app: carta de 14 platos con fotos en 6 idiomas, 9 mesas con QR (salón y terraza), dos camareros y un cocinero con PIN. Sin pedidos: el servicio empieza cuando inicias el turno. Solo se puede usar con el local vacío (sin carta ni mesas).</p>
        </div>
      </div>
      <div className="space-y-3 p-5 pt-3">
        {node}
        {done ? (
          <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <b>Listo:</b> {done.items} platos y {done.tables} mesas.
            {done.staff.length > 0 && <> Entran con PIN: {done.staff.map((x) => `${x.name} → ${x.pin}`).join(" · ")}.</>}
            <button className="btn btn-dark btn-sm ml-2" onClick={() => window.location.reload()}>Ver</button>
          </div>
        ) : (
          <button className="btn btn-primary w-full" disabled={busy} onClick={load}><Sparkles className="size-4" /> {busy ? "Cargando…" : "Cargar datos de ejemplo"}</button>
        )}
      </div>
    </section>
  );
}

// ---------------- Ajustes ----------------
// ---------------- Reservas ----------------
const WEEKDAY_LABEL: Record<Weekday, string> = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo" };

function ReservationsTab() {
  const { token } = useStaff();
  const { wrap, node } = useErr();
  const toast = useToast();
  const [s, setS] = useState<ReservationSettings | null>(null);
  const [notes, setNotes] = useState<VenueNoteDTO[] | null>(null);
  const [nf, setNf] = useState({ date: "", text: "", noReservations: false });
  const [integration, setIntegration] = useState<{ key: { prefix: string; createdAt: string; lastUsedAt: string | null } | null } | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      api<ReservationSettings>("/staff/reservations/settings", { token }),
      api<VenueNoteDTO[]>("/staff/notes", { token }),
      api<{ key: { prefix: string; createdAt: string; lastUsedAt: string | null } | null }>("/staff/integrations", { token }),
    ]);
    setS(a);
    setNotes(b);
    setIntegration(c);
  }, [token]);
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = (API_URL.startsWith("/") && typeof window !== "undefined" ? window.location.origin + API_URL : API_URL) + "/integrations/v1";
  const num = (k: keyof ReservationSettings, label: string, unit: string) => (
    <label><span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input className="input" inputMode="numeric" value={String(s![k])} onChange={(e) => setS({ ...s!, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        <span className="text-sm text-stone-500">{unit}</span>
      </span>
    </label>
  );
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (notes ?? []).filter((n) => !n.date || n.date >= today);

  return (
    <div className="space-y-8">
      {node}
      {toast.node}
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Megaphone className="size-5" /> Pautas para el agente</h3>
        <p className="mb-3 text-sm text-stone-500">
          Lo que el agente de reservas debe saber: «hoy no hacemos reservas, es por orden de llegada», «terraza cerrada por lluvia»… Las de un día solo valen ese día; las permanentes, siempre. El agente las recibe en su prompt.
        </p>
        <form
          className="card mb-3 space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nf.text.trim()) return;
            void wrap(async () => {
              await api("/staff/notes", { body: { date: nf.date || null, text: nf.text.trim(), noReservations: !!nf.date && nf.noReservations }, token });
              setNf({ date: "", text: "", noReservations: false });
              await load();
            });
          }}
        >
          <textarea className="input min-h-20" placeholder="Hoy no hacemos reservas, es por orden de llegada" value={nf.text} onChange={(e) => setNf({ ...nf, text: e.target.value })} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><span className="font-semibold">Día</span>
              <input type="date" className="input w-auto!" value={nf.date} onChange={(e) => setNf({ ...nf, date: e.target.value })} />
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNf({ ...nf, date: today })}>Hoy</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNf({ ...nf, date: "", noReservations: false })}>Siempre</button>
            {nf.date && (
              <label className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <input type="checkbox" className="size-4" checked={nf.noReservations} onChange={(e) => setNf({ ...nf, noReservations: e.target.checked })} /> Ese día no se aceptan reservas
              </label>
            )}
            <button className="btn btn-primary ml-auto" disabled={!nf.text.trim()}><Plus className="size-4" /> Añadir pauta</button>
          </div>
        </form>
        {notes && upcoming.length === 0 && <p className="text-sm text-stone-400">Sin pautas.</p>}
        <ul className="space-y-2">
          {upcoming.map((n) => (
            <li key={n.id} className="card flex items-start gap-3 p-3">
              <span className={cx("chip shrink-0", n.date ? "bg-amber-100 text-amber-900" : "bg-stone-100")}>{n.date ? new Date(`${n.date}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }) : "Siempre"}</span>
              <p className="min-w-0 flex-1 text-sm">{n.text}{n.noReservations && <b className="ml-1 text-red-700">· sin reservas</b>}</p>
              <button className="btn-icon size-8! text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar pauta" onClick={() => wrap(async () => { await api(`/staff/notes/${n.id}`, { method: "DELETE", token }); await load(); })}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      </section>

      {s && (
        <section>
          <h3 className="mb-1 font-display text-xl font-semibold">Horario y capacidad</h3>
          <p className="mb-3 text-sm text-stone-500">Con esto se calculan los huecos libres que ve el agente y el personal.</p>
          <div className="card space-y-4 p-5">
            <Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Aceptar reservas" hint="Si lo apagas, el agente dirá que no se aceptan reservas." />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {num("maxCovers", "Comensales a la vez", "pers.")}
              {num("maxPartySize", "Máximo por reserva", "pers.")}
              {num("durationMinutes", "Duración de una reserva", "min")}
              {num("slotMinutes", "Turnos cada", "min")}
              {num("minNoticeMinutes", "Antelación mínima", "min")}
            </div>
            <div>
              <span className="label">Horario de reservas (vacío = ese día no se reserva)</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {WEEKDAYS.map((d) => (
                  <label key={d} className="flex items-center gap-2">
                    <span className="w-24 text-sm font-semibold">{WEEKDAY_LABEL[d]}</span>
                    <input className="input" placeholder="13:00-16:00, 20:00-23:00" value={s.hours[d]} onChange={(e) => setS({ ...s, hours: { ...s.hours, [d]: e.target.value } })} />
                  </label>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => wrap(async () => { setS(await api<ReservationSettings>("/staff/reservations/settings", { method: "PATCH", body: s, token })); toast.show("Guardado"); })}>Guardar</button>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-display text-xl font-semibold"><Bot className="size-5" /> Agente de reservas (n8n)</h3>
        <p className="mb-3 text-sm text-stone-500">
          Tu flujo de n8n usa esta clave para consultar huecos, reservar, cambiar o cancelar reservas y leer las pautas del día. Las reservas que haga aparecen en «Reservas» con la etiqueta «Agente».
        </p>
        <div className="card space-y-3 p-5">
          <div className="text-sm"><span className="label">Dirección base</span><code className="block rounded-xl bg-stone-100 px-3 py-2 text-xs break-all">{base}</code></div>
          {newKey ? (
            <div className="space-y-2 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <b className="text-sm text-emerald-900">Copia la clave ahora: no se volverá a mostrar.</b>
              <code className="block rounded-xl bg-white px-3 py-2 text-xs break-all">{newKey}</code>
              <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(newKey).then(() => toast.show("Copiada"))}><Copy className="size-3.5" /> Copiar</button>
            </div>
          ) : integration?.key ? (
            <p className="flex items-center gap-2 text-sm"><KeyRound className="size-4 text-emerald-600" /> Clave activa <code className="rounded bg-stone-100 px-1.5">{integration.key.prefix}…</code>
              <span className="text-stone-500">{integration.key.lastUsedAt ? `· último uso ${new Date(integration.key.lastUsedAt).toLocaleString("es-ES")}` : "· aún sin usar"}</span></p>
          ) : (
            <p className="text-sm text-stone-500">Aún no hay clave.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-dark" onClick={() => { if (!integration?.key || confirm("La clave actual dejará de funcionar. ¿Generar una nueva?")) void wrap(async () => { setNewKey((await api<{ key: string }>("/staff/integrations/key", { body: {}, token })).key); await load(); }); }}>
              <KeyRound className="size-4" /> {integration?.key ? "Generar clave nueva" : "Generar clave"}
            </button>
            {integration?.key && (
              <button className="btn text-red-700 hover:bg-red-50" onClick={() => { if (confirm("El agente dejará de poder reservar. ¿Desactivar la clave?")) void wrap(async () => { await api("/staff/integrations/key", { method: "DELETE", token }); setNewKey(null); await load(); }); }}>Desactivar</button>
            )}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Qué puede hacer el agente</summary>
            <ul className="mt-2 space-y-1 font-mono text-xs text-stone-600">
              <li>GET  /guidelines?date=AAAA-MM-DD — pautas del día (texto para el prompt)</li>
              <li>GET  /availability?date=AAAA-MM-DD&amp;party=4 — huecos libres</li>
              <li>GET  /reservations?phone=600… o ?code=ABC123 — buscar reservas</li>
              <li>POST /reservations — reservar {"{name, phone, partySize, date, time, notes}"}</li>
              <li>PATCH /reservations/CODIGO — cambiar día, hora o personas</li>
              <li>DELETE /reservations/CODIGO — cancelar</li>
            </ul>
            <p className="mt-2 text-xs text-stone-500">Cabecera: <code>Authorization: Bearer &lt;clave&gt;</code>. Guía completa en docs/N8N.md.</p>
          </details>
        </div>
      </section>
    </div>
  );
}

function OptionCard({ active, onClick, title, text, icon }: { active: boolean; onClick: () => void; title: string; text: string; icon: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cx("flex flex-col items-start gap-2 rounded-2xl p-4 text-left ring-1 transition", active ? "bg-ink text-white ring-ink shadow-lift" : "bg-white ring-stone-200 hover:ring-stone-300")}>
      <span className={cx("grid size-9 place-items-center rounded-xl", active ? "bg-white/15" : "bg-stone-100 text-stone-600")}>{icon}</span>
      <b className="text-sm">{title}</b>
      <span className={cx("text-xs", active ? "text-white/60" : "text-stone-500")}>{text}</span>
    </button>
  );
}

function SettingsTab() {
  const { token, me } = useStaff();
  const { wrap, node } = useErr();
  const [f, setF] = useState({
    name: me.venueName,
    orderMode: me.orderMode,
    sessionOpenMode: me.sessionOpenMode,
    languages: me.languages as Language[],
    defaultLanguage: me.defaultLanguage,
    features: me.features,
  });
  const [saved, setSaved] = useState(false);
  const feat: { key: keyof StaffMeDTO["features"]; label: string; hint: string }[] = [
    { key: "kitchenDisplay", label: "Pantalla de cocina", hint: "Comandas por estado y avisos sonoros." },
    { key: "waiterView", label: "Vista de sala", hint: "Mapa de mesas, tareas y cobro." },
    { key: "serviceCalls", label: "Llamar al camarero y pedir la cuenta", hint: "Botones en el móvil del comensal." },
  ];
  return (
    <div className="space-y-8">
      {node}
      <section className="card p-5">
        <label className="block"><span className="label">Nombre del local</span><input className="input text-lg!" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      </section>

      <section>
        <h3 className="mb-1 font-display text-xl font-semibold">Pedidos desde el móvil</h3>
        <p className="mb-3 text-sm text-stone-500">Cómo llegan a cocina los pedidos hechos escaneando el QR.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <OptionCard active={f.orderMode === "direct"} onClick={() => setF({ ...f, orderMode: "direct" })} icon={<ChefHat className="size-5" />} title="Directo" text="El pedido entra en cocina al enviarlo." />
          <OptionCard active={f.orderMode === "approval"} onClick={() => setF({ ...f, orderMode: "approval" })} icon={<Eye className="size-5" />} title="Con aprobación" text="Un camarero valida cada pedido antes de cocina." />
          <OptionCard active={f.orderMode === "view_only"} onClick={() => setF({ ...f, orderMode: "view_only" })} icon={<BookOpen className="size-5" />} title="Solo carta" text="Se consulta la carta; pide el camarero." />
        </div>
      </section>

      <section>
        <h3 className="mb-1 font-display text-xl font-semibold">Apertura de mesa</h3>
        <p className="mb-3 text-sm text-stone-500">Quién inicia la sesión de la mesa.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard active={f.sessionOpenMode === "auto"} onClick={() => setF({ ...f, sessionOpenMode: "auto" })} icon={<QrCode className="size-5" />} title="Automática" text="Se abre cuando el primer comensal pide o llama." />
          <OptionCard active={f.sessionOpenMode === "staff"} onClick={() => setF({ ...f, sessionOpenMode: "staff" })} icon={<BellRing className="size-5" />} title="La abre el camarero" text="El QR muestra la carta, pero no deja pedir hasta abrirla." />
        </div>
      </section>

      <section>
        <h3 className="mb-3 flex flex-wrap items-center gap-3 font-display text-xl font-semibold">
          Idiomas de la carta
          <label className="ml-auto flex items-center gap-2 font-sans text-sm font-normal text-stone-500">
            Principal
            <select className="input w-auto! py-1.5!" value={f.defaultLanguage} onChange={(e) => {
              const l = e.target.value as Language;
              setF({ ...f, defaultLanguage: l, languages: f.languages.includes(l) ? f.languages : [...f.languages, l] });
            }}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
            </select>
          </label>
        </h3>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => {
            const on = f.languages.includes(l);
            const isDef = l === f.defaultLanguage;
            return (
              <button
                key={l}
                type="button"
                disabled={isDef}
                onClick={() => setF({ ...f, languages: on ? f.languages.filter((x) => x !== l) : [...f.languages, l] })}
                className={cx("rounded-full px-4 py-2 text-sm font-semibold ring-1 transition disabled:opacity-100", on ? "bg-ink text-white ring-ink" : "bg-white text-stone-500 ring-stone-200 hover:ring-stone-300")}
              >
                {LANGUAGE_NAMES[l]}{isDef && " · principal"}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-display text-xl font-semibold">Módulos</h3>
        <div className="grid gap-2">
          {feat.map((x) => (
            <Switch key={x.key} checked={f.features[x.key]} onChange={(v) => setF({ ...f, features: { ...f.features, [x.key]: v } })} label={x.label} hint={x.hint} />
          ))}
        </div>
      </section>

      <SampleDataCard />

      <div className="sticky bottom-4 flex justify-end">
        <button className={cx("btn btn-lg shadow-lift", saved ? "btn-ok" : "btn-primary")} onClick={() => wrap(async () => {
          await api("/staff/venue", { method: "PATCH", body: f, token });
          setSaved(true);
          setTimeout(() => window.location.reload(), 700);
        })}>{saved ? "Guardado ✓" : "Guardar cambios"}</button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <StaffShell>
      <Admin />
    </StaffShell>
  );
}

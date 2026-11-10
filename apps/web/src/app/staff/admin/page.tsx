"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  LANGUAGES,
  LANGUAGE_NAMES,
  ROLES,
  TAGS,
  TAG_LABELS,
  formatMoney,
  type AdminCategoryDTO,
  type AdminItemDTO,
  type Allergen,
  type Language,
  type StaffMeDTO,
  type StaffTableDTO,
  type Tag,
} from "@resan/shared";
import { api, errorText } from "@/lib/api";
import { storeToken, useStaff } from "@/lib/staff-auth";
import { StaffShell } from "../StaffShell";

type Tab = "menu" | "tables" | "team" | "settings";

function Admin() {
  const { can } = useStaff();
  const tabs = [
    can("menu.edit") && { id: "menu", label: "Carta" },
    can("tables.manage") && { id: "tables", label: "Mesas y QR" },
    can("users.manage") && { id: "team", label: "Equipo" },
    can("venue.settings") && { id: "settings", label: "Local y módulos" },
  ].filter(Boolean) as { id: Tab; label: string }[];
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "menu");
  return (
    <div className="mx-auto max-w-4xl p-3">
      <div className="no-print mb-4 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`btn whitespace-nowrap ${tab === t.id ? "btn-primary" : "btn-ghost"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "menu" && <MenuTab />}
      {tab === "tables" && <TablesTab />}
      {tab === "team" && <TeamTab />}
      {tab === "settings" && <SettingsTab />}
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
  return { error, wrap, node: error ? <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null };
}

// ---------------- Carta ----------------
function MenuTab() {
  const { token, me } = useStaff();
  const [cats, setCats] = useState<AdminCategoryDTO[]>([]);
  const [editing, setEditing] = useState<Partial<AdminItemDTO> | null>(null);
  const [newCat, setNewCat] = useState("");
  const { error, wrap, node } = useErr();
  const load = useCallback(async () => setCats(await api<AdminCategoryDTO[]>("/staff/menu", { token })), [token]);
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = me.defaultLanguage;
  const money = (c: number) => formatMoney(c, def);

  return (
    <div>
      {node}
      <div className="mb-4 flex gap-2">
        <input className="input" placeholder={`Nueva categoría (${LANGUAGE_NAMES[def]})`} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
        <button className="btn btn-primary" disabled={!newCat.trim()} onClick={() => wrap(async () => {
          await api("/staff/categories", { body: { translations: { [def]: { name: newCat.trim() } } }, token });
          setNewCat("");
          await load();
        })}>Añadir</button>
      </div>
      {cats.map((c) => (
        <section key={c.id} className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">{c.translations[def]?.name ?? "(sin nombre)"} {!c.active && <span className="chip">oculta</span>}</h2>
            <div className="flex gap-2">
              <button className="btn btn-ghost !py-1" onClick={() => wrap(async () => { await api(`/staff/categories/${c.id}`, { method: "PATCH", body: { active: !c.active }, token }); await load(); })}>{c.active ? "Ocultar" : "Mostrar"}</button>
              <button className="btn btn-primary !py-1" onClick={() => setEditing({ categoryId: c.id, fulfillment: "kitchen", allergens: [], tags: [], translations: {}, priceCents: 0 })}>＋ Plato</button>
            </div>
          </div>
          <ul className="space-y-2">
            {c.items.map((i) => (
              <li key={i.id} className={`card flex items-center gap-3 p-2 ${i.active ? "" : "opacity-50"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.imageUrl ? <img src={i.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-stone-100">🍽️</div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{i.translations[def]?.name}</div>
                  <div className="text-sm text-stone-500">{money(i.priceCents)} · {i.fulfillment === "kitchen" ? "Cocina" : "Sala (se lleva)"} · {Object.keys(i.translations).length}/{me.languages.length} idiomas</div>
                </div>
                <button className={`btn !py-1 ${i.available ? "btn-ghost" : "btn-danger"}`} onClick={() => wrap(async () => { await api(`/staff/items/${i.id}/availability`, { method: "PATCH", body: { available: !i.available }, token }); await load(); })}>{i.available ? "Disponible" : "Agotado"}</button>
                <button className="btn btn-ghost !py-1" onClick={() => setEditing(i)}>Editar</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing && <ItemEditor item={editing} me={me} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      <span className="hidden">{error}</span>
    </div>
  );
}

function ItemEditor({ item, me, onClose, onSaved }: { item: Partial<AdminItemDTO>; me: StaffMeDTO; onClose: () => void; onSaved: () => void }) {
  const { token } = useStaff();
  const { wrap, node } = useErr();
  const [f, setF] = useState({
    translations: item.translations ?? {},
    price: ((item.priceCents ?? 0) / 100).toFixed(2),
    fulfillment: item.fulfillment ?? "kitchen",
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
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-3" onClick={onClose}>
      <div className="my-4 w-full max-w-xl rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-bold">{item.id ? "Editar plato" : "Nuevo plato"}</h3>
        {node}
        <div className="space-y-3">
          {me.languages.map((l) => (
            <div key={l} className="rounded-xl border border-stone-200 p-2">
              <div className="mb-1 text-xs font-semibold text-stone-500">{LANGUAGE_NAMES[l]}{l === me.defaultLanguage && " (obligatorio)"}</div>
              <input className="input !py-1.5" placeholder="Nombre" value={f.translations[l]?.name ?? ""} onChange={(e) => setTr(l, "name", e.target.value)} />
              <textarea className="input mt-1 !py-1.5 text-sm" rows={2} placeholder="Descripción" value={f.translations[l]?.description ?? ""} onChange={(e) => setTr(l, "description", e.target.value)} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Precio (€ IVA incl.)<input className="input mt-1" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
            <label className="text-sm">Destino
              <select className="input mt-1" value={f.fulfillment} onChange={(e) => setF({ ...f, fulfillment: e.target.value as "kitchen" | "serve" })}>
                <option value="kitchen">Cocina (se cocina)</option>
                <option value="serve">Sala (bebida, postre: se lleva)</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">URL de la imagen
            <input className="input mt-1" placeholder="https://… o /demo/paella.svg" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Alérgenos</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ALLERGENS.map((a) => (
                <button type="button" key={a} onClick={() => setF({ ...f, allergens: toggle(f.allergens, a) })} className={`chip !px-2.5 !py-1 !text-xs ${f.allergens.includes(a) ? "!bg-red-100 !text-red-800" : ""}`}>{ALLERGEN_LABELS[me.defaultLanguage][a]}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Etiquetas</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {TAGS.map((t) => (
                <button type="button" key={t} onClick={() => setF({ ...f, tags: toggle(f.tags, t) })} className={`chip !px-2.5 !py-1 !text-xs ${f.tags.includes(t) ? "!bg-emerald-100 !text-emerald-800" : ""}`}>{TAG_LABELS[me.defaultLanguage][t]}</button>
              ))}
            </div>
          </fieldset>
          {item.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible en la carta</label>}
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary flex-1" onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Mesas y QR ----------------
function TablesTab() {
  const { token } = useStaff();
  const [tables, setTables] = useState<StaffTableDTO[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [zone, setZone] = useState("");
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [newZone, setNewZone] = useState("");
  const { wrap, node } = useErr();

  const load = useCallback(async () => {
    const [t, z] = await Promise.all([api<StaffTableDTO[]>("/staff/tables", { token }), api<{ id: string; name: string }[]>("/staff/zones", { token })]);
    setTables(t);
    setZones(z);
    const next: Record<string, string> = {};
    for (const x of t) next[x.id] = await QRCode.toDataURL(`${window.location.origin}/q/${x.qrToken}`, { margin: 1, width: 360 });
    setQrs(next);
  }, [token]);
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="no-print">
        {node}
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="input !w-40" placeholder="Zona nueva" value={newZone} onChange={(e) => setNewZone(e.target.value)} />
          <button className="btn btn-ghost" disabled={!newZone.trim()} onClick={() => wrap(async () => { await api("/staff/zones", { body: { name: newZone.trim() }, token }); setNewZone(""); await load(); })}>Crear zona</button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <input className="input !w-40" placeholder="Etiqueta (ej. 7)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <select className="input !w-44" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Sin zona</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <button className="btn btn-primary" disabled={!label.trim()} onClick={() => wrap(async () => { await api("/staff/tables", { body: { label: label.trim(), zoneId: zone || null }, token }); setLabel(""); await load(); })}>Añadir mesa</button>
          <button className="btn btn-ghost ml-auto" onClick={() => window.print()}>🖨 Imprimir todos los QR</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
        {tables.map((t) => (
          <div key={t.id} className="card break-inside-avoid p-3 text-center">
            <div className="text-2xl font-bold">Mesa {t.label}</div>
            {qrs[t.id] && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qrs[t.id]} alt={`QR mesa ${t.label}`} className="mx-auto my-2 w-full max-w-48" />}
            <div className="text-xs text-stone-500">Escanea para ver la carta y pedir</div>
            <button className="no-print btn btn-ghost mt-2 !py-1 !text-xs" onClick={() => { if (confirm("El QR actual dejará de funcionar. ¿Regenerar?")) void wrap(async () => { await api(`/staff/tables/${t.id}/regenerate-qr`, { body: {}, token }); await load(); }); }}>Regenerar QR</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Equipo ----------------
interface Member { membershipId: string; userId: string; email: string; name: string; role: (typeof ROLES)[number]; hasPin: boolean }
function TeamTab() {
  const { token, me } = useStaff();
  const [users, setUsers] = useState<Member[]>([]);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "waiter" as Member["role"], pin: "" });
  const { wrap, node } = useErr();
  const load = useCallback(async () => setUsers(await api<Member[]>("/staff/users", { token })), [token]);
  useEffect(() => void wrap(load), [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const roles: readonly Member["role"][] = me.role === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");
  return (
    <div>
      {node}
      <ul className="mb-5 space-y-2">
        {users.map((u) => (
          <li key={u.membershipId} className="card flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1"><b>{u.name}</b><div className="truncate text-sm text-stone-500">{u.email} · {u.hasPin ? "con PIN" : "sin PIN"}</div></div>
            <select className="input !w-36 !py-1" value={u.role} disabled={u.userId === me.userId} onChange={(e) => wrap(async () => { await api(`/staff/users/${u.membershipId}`, { method: "PATCH", body: { role: e.target.value }, token }); await load(); })}>
              {ROLES.map((r) => <option key={r} value={r} disabled={!roles.includes(r)}>{r}</option>)}
            </select>
            <button className="btn btn-ghost !py-1" onClick={() => { const pin = prompt("Nuevo PIN (4-8 dígitos). Vacío para quitarlo:"); if (pin !== null) void wrap(async () => { await api(`/staff/users/${u.membershipId}`, { method: "PATCH", body: { pin: pin || null }, token }); await load(); }); }}>PIN</button>
            {u.userId !== me.userId && <button className="btn btn-ghost !py-1 !text-red-700" onClick={() => { if (confirm(`¿Quitar a ${u.name}?`)) void wrap(async () => { await api(`/staff/users/${u.membershipId}`, { method: "DELETE", token }); await load(); }); }}>Quitar</button>}
          </li>
        ))}
      </ul>
      <div className="card space-y-2 p-3">
        <h3 className="font-semibold">Añadir persona</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder="Correo" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="input" placeholder="Contraseña (mín. 8)" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <input className="input" placeholder="PIN de acceso rápido (opcional)" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} />
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Member["role"] })}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        </div>
        <button className="btn btn-primary" onClick={() => wrap(async () => {
          await api("/staff/users", { body: { ...f, pin: f.pin || undefined }, token });
          setF({ name: "", email: "", password: "", role: "waiter", pin: "" });
          await load();
        })}>Crear</button>
      </div>
    </div>
  );
}

// ---------------- Ajustes ----------------
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
  const feat: { key: keyof StaffMeDTO["features"]; label: string }[] = [
    { key: "kitchenDisplay", label: "Pantalla de cocina" },
    { key: "waiterView", label: "Vista de sala / camareros" },
    { key: "serviceCalls", label: "Llamar al camarero y pedir la cuenta" },
  ];
  return (
    <div className="card max-w-xl space-y-4 p-4">
      {node}
      <label className="block text-sm font-medium">Nombre del local<input className="input mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="block text-sm font-medium">Pedidos desde el móvil
        <select className="input mt-1" value={f.orderMode} onChange={(e) => setF({ ...f, orderMode: e.target.value as typeof f.orderMode })}>
          <option value="direct">Directos (van a cocina al enviar)</option>
          <option value="approval">Con aprobación del camarero</option>
          <option value="view_only">Solo carta (no se pide desde el móvil)</option>
        </select>
      </label>
      <label className="block text-sm font-medium">Apertura de mesa
        <select className="input mt-1" value={f.sessionOpenMode} onChange={(e) => setF({ ...f, sessionOpenMode: e.target.value as typeof f.sessionOpenMode })}>
          <option value="auto">Automática al escanear el QR</option>
          <option value="staff">La abre el camarero</option>
        </select>
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Idiomas de la carta</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <label key={l} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={f.languages.includes(l)} disabled={l === f.defaultLanguage} onChange={(e) => setF({ ...f, languages: e.target.checked ? [...f.languages, l] : f.languages.filter((x) => x !== l) })} /> {LANGUAGE_NAMES[l]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Módulos</legend>
        {feat.map((x) => (
          <label key={x.key} className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.features[x.key]} onChange={(e) => setF({ ...f, features: { ...f.features, [x.key]: e.target.checked } })} /> {x.label}</label>
        ))}
      </fieldset>
      <button className="btn btn-primary" onClick={() => wrap(async () => {
        await api("/staff/venue", { method: "PATCH", body: f, token });
        setSaved(true);
        setTimeout(() => window.location.reload(), 600);
      })}>{saved ? "Guardado ✓" : "Guardar"}</button>
      <button className="hidden" onClick={() => storeToken(null)} />
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

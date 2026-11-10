"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ALLERGEN_LABELS,
  LANGUAGE_NAMES,
  TAG_LABELS,
  formatMoney,
  type GuestSessionDTO,
  type JoinResponseDTO,
  type Language,
  type MenuItemDTO,
  type PublicTableDTO,
} from "@resan/shared";
import { ApiError, api } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { UI } from "@/lib/ui-strings";
import { MenuImage } from "@/components/MenuImage";

interface Stored {
  token: string;
  deviceId: string;
  lang?: Language;
}

const storeKey = (t: string) => `resan.guest.${t}`;
function readStored(t: string): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(storeKey(t)) ?? "null");
  } catch {
    return null;
  }
}
function writeStored(t: string, v: Stored | null) {
  try {
    if (v) localStorage.setItem(storeKey(t), JSON.stringify(v));
    else localStorage.removeItem(storeKey(t));
  } catch {
    /* sin almacenamiento */
  }
}
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function GuestPage() {
  const { token: qr } = useParams<{ token: string }>();
  const [lang, setLang] = useState<Language | null>(null);
  const [data, setData] = useState<PublicTableDTO | null>(null);
  const [session, setSession] = useState<GuestSessionDTO | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, { qty: number; note: string }>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [alias, setAlias] = useState("");
  const [detail, setDetail] = useState<MenuItemDTO | null>(null);
  const idemKey = useRef<string | null>(null);

  const t = UI[lang ?? "es"];
  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const loadMenu = useCallback(
    async (l?: Language | null) => {
      try {
        const d = await api<PublicTableDTO>(`/public/q/${qr}${l ? `?lang=${l}` : ""}`);
        setData(d);
        setLang((cur) => cur ?? d.language);
      } catch (e) {
        setFatal(e instanceof ApiError && e.status === 404 ? "QR no válido" : "Error");
      }
    },
    [qr],
  );

  const loadSession = useCallback(async (tok: string) => {
    try {
      setSession(await api<GuestSessionDTO>("/public/session", { token: tok }));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 410 || e.status === 401)) {
        writeStored(qr, null);
        setGuestToken(null);
        setSession(null);
        if (e.status === 410) setClosed(true);
      }
    }
  }, [qr]);

  useEffect(() => {
    const s = readStored(qr);
    if (s) {
      setGuestToken(s.token);
      if (s.lang) setLang(s.lang);
      void loadSession(s.token);
    }
    void loadMenu(s?.lang);
  }, [qr, loadMenu, loadSession]);

  useRealtime(guestToken, (ev) => {
    if (ev?.type === "menu.updated") void loadMenu(lang);
    if (guestToken) void loadSession(guestToken);
  });

  const changeLang = (l: Language) => {
    setLang(l);
    const s = readStored(qr);
    if (s) writeStored(qr, { ...s, lang: l });
    void loadMenu(l);
    if (guestToken) void api("/public/me", { method: "PATCH", body: { language: l }, token: guestToken }).catch(() => {});
  };

  /** Entra a la mesa la primera vez que hace falta (pedir o llamar), no por el mero hecho de mirar la carta. */
  const ensureJoined = async (): Promise<string | null> => {
    if (guestToken) return guestToken;
    if (!data?.session && data?.venue.sessionOpenMode === "staff") {
      showToast(t.waitingOpen!);
      return null;
    }
    const stored = readStored(qr);
    const deviceId = stored?.deviceId ?? newId();
    const r = await api<JoinResponseDTO>(`/public/q/${qr}/join`, {
      body: { deviceId, language: lang ?? undefined, alias: alias.trim() || undefined },
    });
    writeStored(qr, { token: r.token, deviceId, lang: lang ?? undefined });
    setGuestToken(r.token);
    await loadSession(r.token);
    return r.token;
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        writeStored(qr, null);
        setGuestToken(null);
        setSession(null);
        setClosed(true);
      } else if (e instanceof ApiError && e.code === "item_unavailable") {
        showToast(t.unavailable!);
        void loadMenu(lang);
      } else if (e instanceof ApiError && e.code === "session_not_open") {
        showToast(t.waitingOpen!);
      } else showToast(t.error!);
    } finally {
      setBusy(false);
    }
  };

  const sendOrder = () =>
    guard(async () => {
      const lines = Object.entries(cart).map(([itemId, v]) => ({ itemId, qty: v.qty, note: v.note.trim() || undefined }));
      if (!lines.length) return;
      const tok = await ensureJoined();
      if (!tok) return;
      // La misma clave en reintentos evita duplicar el pedido si la red falla a medias
      idemKey.current ??= newId();
      const r = await api<{ status: string }>("/public/orders", { body: { idempotencyKey: idemKey.current, items: lines }, token: tok });
      idemKey.current = null;
      setCart({});
      setCartOpen(false);
      showToast(r.status === "pending_approval" ? t.approval! : t.sent!);
      await loadSession(tok);
    });

  const call = (type: "waiter" | "bill") =>
    guard(async () => {
      const tok = await ensureJoined();
      if (!tok) return;
      await api("/public/calls", { body: { type }, token: tok });
      showToast(type === "waiter" ? t.waiterCalled! : t.billCalled!);
      await loadSession(tok);
    });

  const money = (c: number) => formatMoney(c, lang ?? "es", data?.venue.currency ?? "EUR");
  const lines = useMemo(() => {
    const byId = new Map<string, MenuItemDTO>();
    data?.menu.categories.forEach((c) => c.items.forEach((i) => byId.set(i.id, i)));
    return Object.entries(cart).flatMap(([id, v]) => {
      const item = byId.get(id);
      return item ? [{ item, ...v }] : [];
    });
  }, [cart, data]);
  const cartCount = lines.reduce((n, l) => n + l.qty, 0);
  const cartTotal = lines.reduce((n, l) => n + l.qty * l.item.priceCents, 0);

  const add = (id: string, d = 1) =>
    setCart((c) => {
      const qty = (c[id]?.qty ?? 0) + d;
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = { qty: Math.min(qty, 20), note: c[id]?.note ?? "" };
      return next;
    });

  if (fatal) return <p className="p-8 text-center text-stone-600">{fatal}</p>;
  if (!data) return <p className="p-8 text-center text-stone-500">{t.loading}</p>;

  const canOrder = data.venue.orderMode !== "view_only";
  const cats = data.menu.categories.filter((c) => category === "all" || c.id === category);
  const billAsked = session?.calls.some((c) => c.type === "bill" && c.status !== "done");
  const waiterAsked = session?.calls.some((c) => c.type === "waiter" && c.status !== "done");

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{data.venue.name}</h1>
            <p className="text-xs text-stone-500">{t.table} {data.table.label}</p>
          </div>
          <select
            aria-label="Language"
            className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
            value={lang ?? data.language}
            onChange={(e) => changeLang(e.target.value as Language)}
          >
            {data.venue.languages.map((l) => (
              <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>
            ))}
          </select>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
          {[{ id: "all", name: t.all! }, ...data.menu.categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium ${category === c.id ? "bg-brand text-white" : "bg-stone-100 text-stone-700"}`}
            >
              {c.name}
            </button>
          ))}
        </nav>
      </header>

      {closed && <div className="m-4 rounded-xl bg-emerald-50 p-4 text-emerald-900">{t.closed}</div>}
      {!data.session && data.venue.sessionOpenMode === "staff" && !guestToken && (
        <div className="m-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.waitingOpen}</div>
      )}
      {!canOrder && <div className="m-4 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{t.viewOnly}</div>}

      {session && (
        <section className="mx-4 mt-4 card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">{t.tableOrders}</h2>
            <span className="text-sm text-stone-500">{t.total}: <b className="text-stone-900">{money(session.totalCents)}</b></span>
          </div>
          {session.items.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">—</p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100 text-sm">
              {session.items.map((i) => {
                const who = session.guests.find((g) => g.id === i.guestId);
                return (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <span className="font-medium">{i.qty}× {i.name}</span>
                      <span className="ml-2 text-xs text-stone-500">{who ? (who.id === session.me.id ? t.me : who.alias) : ""}</span>
                    </div>
                    <span className={`chip shrink-0 ${i.status === "ready" ? "!bg-emerald-100 !text-emerald-800" : i.status === "served" ? "!bg-stone-100 !text-stone-500" : "!bg-amber-100 !text-amber-800"}`}>
                      {t[i.status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost flex-1" disabled={busy || !!waiterAsked} onClick={() => call("waiter")}>🙋 {t.callWaiter}</button>
            <button className="btn btn-ghost flex-1" disabled={busy || !!billAsked} onClick={() => call("bill")}>🧾 {t.askBill}</button>
          </div>
        </section>
      )}

      {!session && !closed && (data.session || data.venue.sessionOpenMode === "auto") && (
        <div className="mx-4 mt-4 flex gap-2">
          <button className="btn btn-ghost flex-1" disabled={busy} onClick={() => call("waiter")}>🙋 {t.callWaiter}</button>
        </div>
      )}

      <main className="space-y-6 px-4 pt-4">
        {cats.map((c) => (
          <section key={c.id}>
            <h2 className="mb-2 text-xl font-bold">{c.name}</h2>
            <ul className="space-y-3">
              {c.items.map((i) => (
                <li key={i.id} className={`card flex gap-3 overflow-hidden ${i.available ? "" : "opacity-60"}`}>
                  <button onClick={() => setDetail(i)} className="shrink-0" aria-label={i.name}>
                    <MenuImage src={i.imageUrl} alt={i.name} className="h-28 w-28" />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col justify-between py-2.5 pr-3">
                    <div>
                      <h3 className="font-semibold leading-tight">{i.name}</h3>
                      <p className="mt-0.5 line-clamp-2 text-sm text-stone-600">{i.description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {i.tags.map((tg) => <span key={tg} className="chip !bg-emerald-50 !text-emerald-800">{TAG_LABELS[lang ?? "es"][tg]}</span>)}
                        {i.allergens.length > 0 && <span className="chip">⚠ {i.allergens.length}</span>}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-bold">{money(i.priceCents)}</span>
                      {!i.available ? (
                        <span className="text-sm text-stone-500">{t.unavailable}</span>
                      ) : canOrder ? (
                        cart[i.id] ? (
                          <div className="flex items-center gap-2">
                            <button className="btn btn-ghost !px-3 !py-1" onClick={() => add(i.id, -1)} aria-label="-">−</button>
                            <span className="w-5 text-center font-semibold">{cart[i.id]!.qty}</span>
                            <button className="btn btn-primary !px-3 !py-1" onClick={() => add(i.id, 1)} aria-label="+">+</button>
                          </div>
                        ) : (
                          <button className="btn btn-primary !py-1.5" onClick={() => add(i.id)}>{t.add}</button>
                        )
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {detail && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setDetail(null)}>
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <MenuImage src={detail.imageUrl} alt={detail.name} className="h-56 w-full" />
            <div className="space-y-2 p-4">
              <h3 className="text-xl font-bold">{detail.name}</h3>
              <p className="text-stone-700">{detail.description}</p>
              {detail.allergens.length > 0 && (
                <p className="text-sm"><b>{t.allergens}:</b> {detail.allergens.map((a) => ALLERGEN_LABELS[lang ?? "es"][a]).join(", ")}</p>
              )}
              <p className="text-lg font-bold">{money(detail.priceCents)}</p>
              <button className="btn btn-ghost w-full" onClick={() => setDetail(null)}>✕</button>
            </div>
          </div>
        </div>
      )}

      {canOrder && cartCount > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3">
          <button className="btn btn-primary mx-auto flex w-full max-w-2xl justify-between !py-3.5 text-base shadow-lg" onClick={() => setCartOpen(true)}>
            <span>{t.cart} · {cartCount}</span>
            <span>{money(cartTotal)}</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setCartOpen(false)}>
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{t.cart}</h3>
            {lines.length === 0 && <p className="py-4 text-stone-500">{t.empty}</p>}
            <ul className="mt-2 space-y-3">
              {lines.map((l) => (
                <li key={l.item.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{l.item.name}</span>
                    <div className="flex items-center gap-2">
                      <button className="btn btn-ghost !px-2.5 !py-0.5" onClick={() => add(l.item.id, -1)}>−</button>
                      <span className="w-5 text-center">{l.qty}</span>
                      <button className="btn btn-ghost !px-2.5 !py-0.5" onClick={() => add(l.item.id, 1)}>+</button>
                    </div>
                  </div>
                  <input
                    className="input mt-1 !py-1.5 text-sm"
                    placeholder={t.note}
                    maxLength={200}
                    value={l.note}
                    onChange={(e) => setCart((c) => ({ ...c, [l.item.id]: { qty: l.qty, note: e.target.value } }))}
                  />
                </li>
              ))}
            </ul>
            {!guestToken && (
              <input className="input mt-3" placeholder={t.yourName} maxLength={30} value={alias} onChange={(e) => setAlias(e.target.value)} />
            )}
            {data.venue.orderMode === "approval" && <p className="mt-3 text-sm text-stone-600">{t.approval}</p>}
            <button className="btn btn-primary mt-4 w-full !py-3.5 text-base" disabled={busy || lines.length === 0} onClick={sendOrder}>
              {t.send} · {money(cartTotal)}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 top-20 z-40 mx-auto w-fit max-w-[90%] rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}

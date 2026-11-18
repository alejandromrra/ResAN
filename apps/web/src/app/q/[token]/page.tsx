"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ALLERGEN_LABELS,
  LANGUAGE_NAMES,
  TAG_LABELS,
  formatMoney,
  type GuestSessionDTO,
  type ItemStatus,
  type JoinResponseDTO,
  type Language,
  type MenuItemDTO,
  type PublicTableDTO,
} from "@resan/shared";
import {
  BellRing,
  Check,
  ChefHat,
  ChevronRight,
  Clock,
  Globe,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { ApiError, api, newId } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { UI } from "@/lib/ui-strings";
import { ALLERGEN_ICON, TAG_STYLE } from "@/lib/visual";
import { MenuImage } from "@/components/MenuImage";
import { Sheet, Stepper, cx, useToast } from "@/components/ui";

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

const STATUS_STYLE: Record<ItemStatus, string> = {
  pending_approval: "bg-orange-50 text-orange-700 ring-orange-200",
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  preparing: "bg-amber-50 text-amber-800 ring-amber-200",
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  served: "bg-stone-100 text-stone-500 ring-stone-200",
  cancelled: "bg-stone-100 text-stone-400 ring-stone-200 line-through",
};
const STEPS: ItemStatus[] = ["new", "preparing", "ready", "served"];

export default function GuestPage() {
  const { token: qr } = useParams<{ token: string }>();
  const [lang, setLang] = useState<Language | null>(null);
  const [data, setData] = useState<PublicTableDTO | null>(null);
  const [session, setSession] = useState<GuestSessionDTO | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, { qty: number; note: string }>>({});
  const [sheet, setSheet] = useState<"cart" | "table" | "lang" | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [alias, setAlias] = useState("");
  const [detail, setDetail] = useState<MenuItemDTO | null>(null);
  const [bump, setBump] = useState(0);
  const idemKey = useRef<string | null>(null);
  const toast = useToast();

  const t = UI[lang ?? "es"];

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

  // Sin unirse no hay tiempo real: se refresca la carta (agotados, mesa abierta por el camarero)
  useEffect(() => {
    if (guestToken) return;
    const i = setInterval(() => void loadMenu(lang), 20_000);
    return () => clearInterval(i);
  }, [guestToken, lang, loadMenu]);

  // Categoría visible al hacer scroll
  useEffect(() => {
    if (!data) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActiveCat(vis.target.getAttribute("data-cat"));
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    document.querySelectorAll("[data-cat]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [data, query]);

  useEffect(() => {
    if (!activeCat) return;
    document.getElementById(`tab-${activeCat}`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeCat]);

  const changeLang = (l: Language) => {
    setLang(l);
    setSheet(null);
    const s = readStored(qr);
    if (s) writeStored(qr, { ...s, lang: l });
    void loadMenu(l);
    if (guestToken) void api("/public/me", { method: "PATCH", body: { language: l }, token: guestToken }).catch(() => {});
  };

  /** Entra a la mesa la primera vez que hace falta (pedir o llamar), no por el mero hecho de mirar la carta. */
  const ensureJoined = async (): Promise<string | null> => {
    if (guestToken) return guestToken;
    const stored = readStored(qr);
    const deviceId = stored?.deviceId ?? newId();
    const r = await api<JoinResponseDTO>(`/public/q/${qr}/join`, {
      body: { deviceId, language: lang ?? undefined, alias: alias.trim() || undefined },
    });
    writeStored(qr, { token: r.token, deviceId, lang: lang ?? undefined });
    setGuestToken(r.token);
    setClosed(false);
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
        toast.show(t.unavailable!, "error");
        void loadMenu(lang);
      } else if (e instanceof ApiError && e.code === "shift_closed") {
        toast.show(t.serviceClosed!, "info");
        void loadMenu(lang);
      } else if (e instanceof ApiError && e.code === "session_not_open") {
        toast.show(t.waitingOpen!, "info");
        void loadMenu(lang);
      } else toast.show(t.error!, "error");
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
      setSheet(null);
      toast.show(r.status === "pending_approval" ? t.approval! : t.sent!);
      await loadSession(tok);
    });

  const call = (type: "waiter" | "bill") =>
    guard(async () => {
      const tok = await ensureJoined();
      if (!tok) return;
      await api("/public/calls", { body: { type }, token: tok });
      toast.show(type === "waiter" ? t.waiterCalled! : t.billCalled!);
      await loadSession(tok);
    });

  const money = (c: number) => formatMoney(c, lang ?? "es", data?.venue.currency ?? "EUR");
  const byId = useMemo(() => {
    const m = new Map<string, MenuItemDTO>();
    data?.menu.categories.forEach((c) => c.items.forEach((i) => m.set(i.id, i)));
    return m;
  }, [data]);
  const lines = useMemo(
    () => Object.entries(cart).flatMap(([id, v]) => {
      const item = byId.get(id);
      return item ? [{ item, ...v }] : [];
    }),
    [cart, byId],
  );
  const cartCount = lines.reduce((n, l) => n + l.qty, 0);
  const cartTotal = lines.reduce((n, l) => n + l.qty * l.item.priceCents, 0);

  const setQty = (id: string, qty: number, note?: string) => {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = { qty: Math.min(qty, 20), note: note ?? c[id]?.note ?? "" };
      return next;
    });
    if (qty > (cart[id]?.qty ?? 0)) setBump((b) => b + 1);
  };

  const categories = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!data) return [];
    if (!q) return data.menu.categories;
    return data.menu.categories
      .map((c) => ({ ...c, items: c.items.filter((i) => `${i.name} ${i.description}`.toLocaleLowerCase().includes(q)) }))
      .filter((c) => c.items.length > 0);
  }, [data, query]);

  if (fatal) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="animate-fade-up">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-white text-3xl shadow-soft">🔍</div>
          <p className="font-display text-2xl">{fatal}</p>
        </div>
      </div>
    );
  }
  if (!data) return <GuestSkeleton />;

  const L = lang ?? "es";
  // Sin turno abierto solo se puede ver la carta
  const serviceOpen = data.serviceOpen;
  const canOrder = data.venue.orderMode !== "view_only" && serviceOpen;
  const calls = data.venue.features.serviceCalls && serviceOpen;
  const waitingOpen = serviceOpen && !data.session && data.venue.sessionOpenMode === "staff" && !guestToken;
  const billAsked = session?.calls.some((c) => c.type === "bill" && c.status !== "done");
  const waiterAsked = session?.calls.some((c) => c.type === "waiter" && c.status !== "done");
  const activeItems = session?.items.filter((i) => i.status !== "cancelled") ?? [];
  const cooking = activeItems.filter((i) => i.status === "new" || i.status === "preparing").reduce((n, i) => n + i.qty, 0);
  const readyNow = activeItems.filter((i) => i.status === "ready").reduce((n, i) => n + i.qty, 0);

  const scrollTo = (id: string) => {
    const el = document.querySelector(`[data-cat="${id}"]`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 128, behavior: "smooth" });
  };

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-36">
      {toast.node}

      {/* Cabecera */}
      <header className={cx("relative overflow-hidden bg-ink px-5 pt-6 text-white", closed || waitingOpen || !canOrder || !serviceOpen || session ? "pb-16" : "pb-8")}>
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-10 size-72 rounded-full bg-gold/25 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide uppercase ring-1 ring-white/15 backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-400" /> {t.table} {data.table.label}
          </span>
          {data.venue.languages.length > 1 && (
            <button onClick={() => setSheet("lang")} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20">
              <Globe className="size-3.5" /> {L}
            </button>
          )}
        </div>
        <h1 className="relative mt-6 animate-fade-up font-display text-4xl leading-tight font-semibold sm:text-5xl">{data.venue.name}</h1>
        <p className="relative mt-1 animate-fade-up text-sm text-white/60 [animation-delay:80ms]">
          {data.menu.categories.reduce((n, c) => n + c.items.length, 0)} {t.items} · {data.menu.categories.map((c) => c.name).slice(0, 3).join(" · ")}
        </p>
      </header>

      {/* Estado de la mesa */}
      <div className={cx("relative z-10 space-y-3 px-4", (closed || waitingOpen || !canOrder || !serviceOpen || session) && "-mt-10")}>
        {closed && (
          <div className="card animate-fade-up overflow-hidden p-5 text-center">
            <div className="mx-auto mb-2 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-2xl">🙏</div>
            <p className="font-display text-xl font-semibold">{t.thanks}</p>
            <p className="text-sm text-stone-500">{t.closed}</p>
          </div>
        )}
        {waitingOpen && !closed && (
          <div className="card flex animate-fade-up items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-600"><Clock className="size-5" /></div>
            <div className="text-sm"><b className="block">{t.waitingOpen}</b><span className="text-stone-500">{t.waitingHint}</span></div>
          </div>
        )}
        {!serviceOpen && !closed && (
          <div className="card flex animate-fade-up items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-stone-100 text-stone-600"><Clock className="size-5" /></div>
            <p className="text-sm text-stone-700">{t.serviceClosed}</p>
          </div>
        )}
        {serviceOpen && !canOrder && !closed && (
          <div className="card flex animate-fade-up items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-stone-100 text-stone-600"><Sparkles className="size-5" /></div>
            <p className="text-sm text-stone-700">{t.viewOnly}</p>
          </div>
        )}
        {session && (
          <button onClick={() => setSheet("table")} className="card card-hover flex w-full animate-fade-up items-center gap-3 p-4 text-left">
            <div className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <Users className="size-5" />
              {readyNow > 0 && <span className="absolute -top-1 -right-1 size-3 animate-ring rounded-full bg-emerald-500 text-emerald-500/50" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <b>{t.myTable}</b>
                <span className="font-display text-lg font-semibold tabular-nums">{money(session.totalCents)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-stone-500">
                <span>{session.guests.length} 👤</span>
                {cooking > 0 && <span className="text-amber-700">● {cooking} {t.inKitchen}</span>}
                {readyNow > 0 && <span className="font-semibold text-emerald-700">● {readyNow} {t.readyCount}</span>}
                {activeItems.length === 0 && <span>{t.tableEmpty}</span>}
              </div>
            </div>
            <ChevronRight className="size-5 text-stone-400" />
          </button>
        )}
      </div>

      {/* Buscador + categorías */}
      <nav className="glass sticky top-0 z-20 mt-4 border-b border-stone-200/60">
        <div className="flex items-center gap-2 px-4 py-2.5">
          {searching ? (
            <div className="relative flex-1 animate-scale-in">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <input autoFocus className="input rounded-full! py-2! pl-9" placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          ) : (
            <div className="scrollbar-none flex flex-1 gap-1.5 overflow-x-auto">
              {data.menu.categories.map((c) => (
                <button
                  id={`tab-${c.id}`}
                  key={c.id}
                  onClick={() => scrollTo(c.id)}
                  className={cx(
                    "rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition",
                    activeCat === c.id ? "bg-ink text-white shadow-soft" : "text-stone-600 hover:bg-stone-900/5",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { setSearching((s) => !s); setQuery(""); }}
            className="btn-icon shrink-0 bg-stone-900/5 text-stone-700 hover:bg-stone-900/10"
            aria-label={t.search}
          >
            {searching ? <X className="size-5" /> : <Search className="size-5" />}
          </button>
        </div>
      </nav>

      {/* Carta */}
      <main className="space-y-9 px-4 pt-6">
        {categories.length === 0 && <p className="py-10 text-center text-stone-500">{t.noResults}</p>}
        {categories.map((c) => (
          <section key={c.id} data-cat={c.id}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-[1.7rem] font-semibold">{c.name}</h2>
              <span className="text-xs font-medium text-stone-400">{c.items.length}</span>
            </div>
            <ul className="space-y-3">
              {c.items.map((i, idx) => {
                const qty = cart[i.id]?.qty ?? 0;
                return (
                  <li
                    key={i.id}
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                    className={cx("card card-hover group relative flex animate-fade-up gap-3.5 p-2.5", !i.available && "opacity-60 grayscale", qty > 0 && "ring-2 ring-brand-300")}
                  >
                    <button onClick={() => setDetail(i)} className="shrink-0 overflow-hidden rounded-xl" aria-label={i.name}>
                      <MenuImage src={i.imageUrl} alt={i.name} className="size-28 rounded-xl transition duration-500 group-hover:scale-105" />
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col py-1 pr-1">
                      <button onClick={() => setDetail(i)} className="text-left">
                        <h3 className="leading-snug font-semibold">{i.name}</h3>
                        <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-stone-500">{i.description}</p>
                      </button>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {i.tags.map((tg) => (
                          <span key={tg} className={cx("chip ring-1", TAG_STYLE[tg].cls)}>{TAG_STYLE[tg].icon} {TAG_LABELS[L][tg]}</span>
                        ))}
                        {i.allergens.length > 0 && (
                          <span className="ml-0.5 text-sm tracking-tight" title={i.allergens.map((a) => ALLERGEN_LABELS[L][a]).join(", ")}>
                            {i.allergens.slice(0, 5).map((a) => ALLERGEN_ICON[a]).join("")}
                            {i.allergens.length > 5 && <span className="text-xs text-stone-400"> +{i.allergens.length - 5}</span>}
                          </span>
                        )}
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="font-display text-lg font-semibold tabular-nums">{money(i.priceCents)}</span>
                        {!i.available ? (
                          <span className="chip bg-stone-200!">{t.unavailable}</span>
                        ) : canOrder ? (
                          qty > 0 ? (
                            <Stepper size="sm" value={qty} onChange={(v) => setQty(i.id, v)} />
                          ) : (
                            <button className="btn-icon size-9! bg-ink text-white shadow-soft hover:bg-brand-600" onClick={() => setQty(i.id, 1)} aria-label={t.add}>
                              <Plus className="size-5" />
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>

      {/* Barra inferior */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pt-8 pb-[max(env(safe-area-inset-bottom),12px)] [background:linear-gradient(to_top,var(--color-cream)_55%,transparent)]">
        <div className="pointer-events-auto mx-auto flex max-w-2xl items-center gap-2">
          {calls && !closed && !waitingOpen && (
            <>
              <button
                className={cx("btn-icon size-14! shrink-0 shadow-lift", waiterAsked ? "bg-emerald-600 text-white" : "bg-white text-ink")}
                disabled={busy || !!waiterAsked}
                onClick={() => call("waiter")}
                aria-label={t.callWaiter}
                title={t.callWaiter}
              >
                {waiterAsked ? <Check className="size-6" /> : <BellRing className="size-6" />}
              </button>
              {session && (
                <button
                  className={cx("btn-icon size-14! shrink-0 shadow-lift", billAsked ? "bg-emerald-600 text-white" : "bg-white text-ink")}
                  disabled={busy || !!billAsked || session.totalCents === 0}
                  onClick={() => call("bill")}
                  aria-label={t.askBill}
                  title={t.askBill}
                >
                  {billAsked ? <Check className="size-6" /> : <Receipt className="size-6" />}
                </button>
              )}
            </>
          )}
          {canOrder && cartCount > 0 ? (
            <button key={bump} className="btn btn-primary btn-lg h-14 flex-1 animate-pop justify-between shadow-glow" onClick={() => setSheet("cart")}>
              <span className="flex items-center gap-2.5">
                <span className="relative">
                  <ShoppingBag className="size-5" />
                  <span className="absolute -top-2 -right-2.5 grid size-5 place-items-center rounded-full bg-white text-[11px] font-bold text-brand-700">{cartCount}</span>
                </span>
                <span className="ml-1">{t.cart}</span>
              </span>
              <span className="tabular-nums">{money(cartTotal)}</span>
            </button>
          ) : (
            calls && !closed && !waitingOpen && (
              <div className="flex-1 truncate rounded-2xl bg-white/70 px-4 py-2 text-xs text-stone-500 backdrop-blur">
                {waiterAsked ? t.waiterCalled : billAsked ? t.billCalled : `${t.callWaiter} · ${t.askBill}`}
              </div>
            )
          )}
        </div>
      </div>

      {/* Detalle de plato */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} className="pt-0!">
        {detail && (
          <DishDetail
            item={detail}
            lang={L}
            money={money}
            canOrder={canOrder}
            inCart={cart[detail.id]}
            onAdd={(qty, note) => { setQty(detail.id, (cart[detail.id]?.qty ?? 0) + qty, note); setDetail(null); toast.show(`${qty}× ${detail.name}`); }}
            onClose={() => setDetail(null)}
          />
        )}
      </Sheet>

      {/* Carrito */}
      <Sheet open={sheet === "cart"} onClose={() => setSheet(null)} title={t.cart}>
        <div className="px-5 pt-2 pb-5">
          {lines.length === 0 && <p className="py-8 text-center text-stone-500">{t.empty}</p>}
          <ul className="divide-y divide-stone-100">
            {lines.map((l) => (
              <li key={l.item.id} className="flex gap-3 py-3">
                <MenuImage src={l.item.imageUrl} alt="" className="size-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="leading-tight font-semibold">{l.item.name}</span>
                    <span className="font-semibold tabular-nums">{money(l.qty * l.item.priceCents)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Stepper size="sm" value={l.qty} onChange={(v) => setQty(l.item.id, v)} />
                    <input
                      className="input flex-1 py-1.5! text-xs!"
                      placeholder={t.note}
                      maxLength={200}
                      value={l.note}
                      onChange={(e) => setCart((c) => ({ ...c, [l.item.id]: { qty: l.qty, note: e.target.value } }))}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {!guestToken && lines.length > 0 && (
            <label className="mt-3 block">
              <span className="label">{t.yourName}</span>
              <input className="input" maxLength={30} value={alias} onChange={(e) => setAlias(e.target.value)} />
            </label>
          )}
          {data.venue.orderMode === "approval" && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><Clock className="size-4" /> {t.approval}</p>
          )}
          <button className="btn btn-primary btn-lg mt-4 w-full justify-between" disabled={busy || lines.length === 0} onClick={sendOrder}>
            <span>{t.send}</span>
            <span className="tabular-nums">{money(cartTotal)}</span>
          </button>
        </div>
      </Sheet>

      {/* Mesa */}
      <Sheet open={sheet === "table" && !!session} onClose={() => setSheet(null)} title={`${t.table} ${data.table.label}`}>
        {session && <TableSheet session={session} t={t} money={money} />}
      </Sheet>

      {/* Idioma */}
      <Sheet open={sheet === "lang"} onClose={() => setSheet(null)} title={t.language}>
        <div className="grid grid-cols-2 gap-2 px-5 pt-2 pb-6">
          {data.venue.languages.map((l) => (
            <button key={l} onClick={() => changeLang(l)} className={cx("flex items-center justify-between rounded-2xl border px-4 py-3 text-left font-semibold transition", l === L ? "border-ink bg-ink text-white" : "border-stone-200 hover:border-stone-300")}>
              {LANGUAGE_NAMES[l]}
              <span className={cx("text-xs uppercase", l === L ? "text-white/60" : "text-stone-400")}>{l}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function DishDetail({
  item,
  lang,
  money,
  canOrder,
  inCart,
  onAdd,
  onClose,
}: {
  item: MenuItemDTO;
  lang: Language;
  money: (c: number) => string;
  canOrder: boolean;
  inCart?: { qty: number; note: string };
  onAdd: (qty: number, note: string) => void;
  onClose: () => void;
}) {
  const t = UI[lang];
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState(inCart?.note ?? "");
  return (
    <div>
      <div className="relative">
        <MenuImage src={item.imageUrl} alt={item.name} className="h-64 w-full sm:h-72" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
        <button className="btn-icon absolute top-3 right-3 bg-white/90 text-ink shadow-soft backdrop-blur" onClick={onClose} aria-label="✕"><X className="size-5" /></button>
        <span className="absolute bottom-4 left-5 rounded-full bg-white px-3 py-1 font-display text-lg font-semibold shadow-soft">{money(item.priceCents)}</span>
      </div>
      <div className="space-y-4 p-5">
        <div>
          <h3 className="font-display text-3xl leading-tight font-semibold">{item.name}</h3>
          {item.description && <p className="mt-1.5 leading-relaxed text-stone-600">{item.description}</p>}
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tg) => <span key={tg} className={cx("chip px-3! py-1! text-xs! ring-1", TAG_STYLE[tg].cls)}>{TAG_STYLE[tg].icon} {TAG_LABELS[lang][tg]}</span>)}
          </div>
        )}
        {item.allergens.length > 0 && (
          <div>
            <div className="label">{t.allergens}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {item.allergens.map((a) => (
                <div key={a} className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200/70">
                  <span className="text-base">{ALLERGEN_ICON[a]}</span> {ALLERGEN_LABELS[lang][a]}
                </div>
              ))}
            </div>
          </div>
        )}
        {canOrder && item.available && (
          <>
            <input className="input" placeholder={t.note} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex items-center gap-3">
              <Stepper value={qty} onChange={(v) => setQty(Math.max(1, v))} />
              <button className="btn btn-primary btn-lg flex-1 justify-between" onClick={() => onAdd(qty, note)}>
                <span>{t.addToOrder}</span>
                <span className="tabular-nums">{money(qty * item.priceCents)}</span>
              </button>
            </div>
          </>
        )}
        {!item.available && <p className="rounded-xl bg-stone-100 p-3 text-center text-sm font-semibold text-stone-600">{t.unavailable}</p>}
      </div>
    </div>
  );
}

function TableSheet({ session, t, money }: { session: GuestSessionDTO; t: Record<string, string>; money: (c: number) => string }) {
  const rounds = [...new Set(session.items.map((i) => i.round))];
  return (
    <div className="px-5 pt-2 pb-6">
      <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-3">
        {session.guests.map((g) => (
          <span key={g.id} className={cx("chip shrink-0 px-3! py-1! text-xs!", g.id === session.me.id && "bg-ink! text-white!")}>
            {g.id === session.me.id ? `${g.alias} (${t.me})` : g.alias}
          </span>
        ))}
      </div>
      {session.items.length === 0 && <p className="py-6 text-center text-sm text-stone-500">{t.tableEmpty}</p>}
      <div className="space-y-4">
        {rounds.map((r) => (
          <div key={r}>
            <div className="label">{t.round} {r}</div>
            <ul className="space-y-2">
              {session.items.filter((i) => i.round === r).map((i) => {
                const who = session.guests.find((g) => g.id === i.guestId);
                const step = STEPS.indexOf(i.status);
                return (
                  <li key={i.id} className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{i.qty}× {i.name}</div>
                        <div className="text-xs text-stone-500">{who ? (who.id === session.me.id ? t.me : who.alias) : "—"} · {money(i.qty * i.unitCents)}</div>
                      </div>
                      <span className={cx("chip shrink-0 ring-1", STATUS_STYLE[i.status])}>
                        {i.status === "preparing" && <ChefHat className="size-3" />}
                        {t[i.status]}
                      </span>
                    </div>
                    {step >= 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {STEPS.map((s, k) => (
                          <span key={s} className={cx("h-1 rounded-full transition-colors duration-500", k <= step ? (i.status === "ready" ? "bg-emerald-500" : "bg-brand-500") : "bg-stone-200")} />
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-baseline justify-between border-t border-stone-200 pt-4">
        <span className="text-stone-500">{t.total}</span>
        <span className="font-display text-2xl font-semibold tabular-nums">{money(session.totalCents)}</span>
      </div>
    </div>
  );
}

function GuestSkeleton() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="h-44 bg-ink" />
      <div className="space-y-3 p-4">
        <div className="skeleton h-10 w-2/3" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex gap-3 p-2.5">
            <div className="skeleton size-28" />
            <div className="flex-1 space-y-2 py-2">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-3 w-5/6" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

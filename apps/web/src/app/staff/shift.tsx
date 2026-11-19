"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_METHODS, formatMoney, type CashDTO, type PaymentMethod, type ShiftDTO, type ShiftStateDTO } from "@resan/shared";
import { Banknote, CircleStop, Clock, CreditCard, Hourglass, PlayCircle, Receipt, Wallet } from "lucide-react";
import { ApiError, api, errorText } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useStaff } from "@/lib/staff-auth";
import { ErrorBanner, FullScreenLoader, Sheet, Spinner, cx } from "@/components/ui";

export const METHOD_LABEL: Record<PaymentMethod, string> = { card: "Tarjeta", cash: "Efectivo", other: "Otros" };
const METHOD_ICON: Record<PaymentMethod, typeof CreditCard> = { card: CreditCard, cash: Banknote, other: Wallet };

const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

/** Estado del turno del local, actualizado en vivo. */
export function useShiftState() {
  const { token } = useStaff();
  const [state, setState] = useState<ShiftStateDTO | null>(null);
  const load = useCallback(async () => {
    try {
      setState(await api<ShiftStateDTO>("/staff/shift", { token }));
    } catch {
      /* se reintenta con el siguiente evento */
    }
  }, [token]);
  useEffect(() => void load(), [load]);
  useRealtime(token, (ev) => {
    if (!ev || ev.type === "shift.updated" || ev.type === "resync" || ev.type === "reconnected" || ev.type === "visible") void load();
  });
  return { state, reload: load };
}

const ShiftCtx = createContext<ShiftDTO | null>(null);
export const useCurrentShift = () => useContext(ShiftCtx);

/**
 * Sala y cocina solo funcionan con el turno abierto. El encargado lo inicia desde aquí; el resto
 * del equipo ve una pantalla de espera que se abre sola cuando empieza el turno.
 */
export function ShiftGate({ children, dark }: { children: ReactNode; dark?: boolean }) {
  const { can, token } = useStaff();
  const { state, reload } = useShiftState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashOpen, setCashOpen] = useState(false);

  if (!state) return <FullScreenLoader />;
  if (state.current) return <ShiftCtx.Provider value={state.current}>{children}</ShiftCtx.Provider>;

  const manager = can("shift.manage");
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/staff/shift/open", { body: {}, token });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[calc(100dvh-4rem)] place-items-center p-6">
      <div className={cx("w-full max-w-md animate-scale-in rounded-[32px] p-8 text-center", dark ? "bg-white/5 ring-1 ring-white/10" : "card shadow-lift")}>
        {manager ? (
          <>
            <div className="mx-auto mb-5 grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-glow"><PlayCircle className="size-10" /></div>
            <h1 className="font-display text-3xl font-semibold">Turno cerrado</h1>
            <p className={cx("mt-2 text-sm", dark ? "text-white/60" : "text-stone-500")}>
              Al iniciar el turno, los camareros y la cocina empiezan a recibir mesas y comandas, y los clientes pueden pedir desde el QR.
            </p>
            {error && <div className="mt-4 text-left"><ErrorBanner>{error}</ErrorBanner></div>}
            <button className="btn btn-primary btn-lg mt-6 w-full" disabled={busy} onClick={start}>{busy ? <Spinner /> : <><PlayCircle className="size-5" /> Iniciar turno</>}</button>
            {state.last && (
              <a href={`/staff/dashboard?shift=${state.last.id}`} className={cx("mt-3 block text-sm font-semibold", dark ? "text-white/60 hover:text-white" : "text-stone-500 hover:text-ink")}>
                Ver resumen del último turno ({day(state.last.openedAt)})
              </a>
            )}
          </>
        ) : (
          <>
            <div className={cx("mx-auto mb-5 grid size-20 place-items-center rounded-3xl", dark ? "bg-white/10 text-white/70" : "bg-stone-100 text-stone-500")}>
              <Hourglass className="size-9 animate-pulse" />
            </div>
            <h1 className="font-display text-3xl font-semibold">Esperando al encargado</h1>
            <p className={cx("mt-2 text-sm", dark ? "text-white/60" : "text-stone-500")}>
              El turno aún no ha empezado. Esta pantalla se abrirá sola en cuanto el encargado lo inicie.
            </p>
            {state.last && can("bill.manage") && (
              <>
                <button className="btn btn-ghost mt-6 w-full" onClick={() => setCashOpen(true)}><Receipt className="size-4" /> Mi caja del último turno</button>
                <CashSheet open={cashOpen} onClose={() => setCashOpen(false)} shiftId={state.last.id} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Barra del turno: cuándo empezó y, según el rol, «Mi caja» o «Cerrar turno». */
export function ShiftBar({ dark }: { dark?: boolean }) {
  const shift = useCurrentShift();
  const { can, token } = useStaff();
  const router = useRouter();
  const [cashOpen, setCashOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTables, setOpenTables] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Solo el encargado ve la barra del turno; el resto del equipo trabaja sin ella
  if (!shift || !can("shift.manage")) return null;

  const close = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const summary = await api<{ shift: ShiftDTO }>("/staff/shift/close", { body: { force }, token });
      router.push(`/staff/dashboard?shift=${summary.shift.id}&closed=1`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "open_tables") {
        setOpenTables((e.details as { tables?: string[] })?.tables ?? []);
      } else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 text-sm", dark ? "bg-white/5 ring-1 ring-white/10" : "bg-white shadow-soft ring-1 ring-stone-200/70")}>
      <span className="relative mr-1 flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span>
      <span className={dark ? "text-white/80" : "text-stone-600"}>
        Turno abierto desde las <b className={dark ? "text-white" : "text-ink"}>{hour(shift.openedAt)}</b>{shift.openedBy && <> · lo inició {shift.openedBy}</>}
      </span>
      <div className="ml-auto flex gap-2">
        {can("bill.manage") && (
          <button className={cx("btn btn-sm", dark ? "bg-white/10 text-white hover:bg-white/15" : "btn-ghost")} onClick={() => setCashOpen(true)}><Receipt className="size-3.5" /> Mi caja</button>
        )}
        {(
          <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700" onClick={() => { setError(null); setOpenTables([]); setClosing(true); }}><CircleStop className="size-3.5" /> Cerrar turno</button>
        )}
      </div>
      <CashSheet open={cashOpen} onClose={() => setCashOpen(false)} />
      <Sheet open={closing} onClose={() => setClosing(false)} title="Cerrar turno">
        <div className="space-y-4 px-5 pt-2 pb-6">
          <p className="text-sm text-stone-600">
            Se cierra el turno para todo el equipo: los camareros y la cocina pasan a la pantalla de espera y los clientes ya no pueden pedir.
            Verás el resumen del turno: cada camarero y cocinero, retrasos y caja.
          </p>
          <ErrorBanner>{error}</ErrorBanner>
          {openTables.length > 0 ? (
            <div className="space-y-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="text-sm text-amber-900">
                <b>Quedan {openTables.length === 1 ? "1 mesa abierta" : `${openTables.length} mesas abiertas`}: {openTables.join(", ")}.</b>{" "}
                Lo normal es cobrarlas antes. Si son mesas que ya se fueron o datos de prueba, puedes cerrarlas sin cobrar: lo que no se haya servido se anula y queda registrado.
              </p>
              <button className="btn btn-danger w-full" disabled={busy} onClick={() => close(true)}>{busy ? <Spinner /> : "Cerrarlas sin cobrar y cerrar el turno"}</button>
            </div>
          ) : (
            <button className="btn btn-danger btn-lg w-full" disabled={busy} onClick={() => close()}>{busy ? <Spinner /> : "Cerrar turno y ver el resumen"}</button>
          )}
        </div>
      </Sheet>
    </div>
  );
}

/** Caja de un camarero: lo cobrado por forma de pago, propinas y el detalle de cobros. */
export function CashSheet({ open, onClose, shiftId, userId, title }: { open: boolean; onClose: () => void; shiftId?: string; userId?: string; title?: string }) {
  const { token, me } = useStaff();
  const [cash, setCash] = useState<CashDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setCash(null);
    const q = new URLSearchParams({ ...(shiftId ? { shift: shiftId } : {}), ...(userId ? { user: userId } : {}) });
    api<CashDTO>(`/staff/shift/cash?${q}`, { token }).then(setCash).catch((e) => setError(errorText(e)));
  }, [open, shiftId, userId, token]);
  const money = (c: number) => formatMoney(c, me.defaultLanguage);
  return (
    <Sheet open={open} onClose={onClose} title={title ?? "Mi caja"}>
      <div className="px-5 pt-1 pb-6">
        <ErrorBanner>{error}</ErrorBanner>
        {!cash && !error && <div className="skeleton h-40" />}
        {cash && (
          <>
            <p className="mb-4 flex items-center gap-1.5 text-sm text-stone-500">
              <Clock className="size-4" /> {day(cash.shift.openedAt)}, {hour(cash.shift.openedAt)}–{cash.shift.closedAt ? hour(cash.shift.closedAt) : "ahora"}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => {
                const Icon = METHOD_ICON[m];
                return (
                  <div key={m} className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200/70">
                    <Icon className="mb-1 size-4 text-stone-500" />
                    <div className="font-display text-xl font-semibold tabular-nums">{money(cash.byMethod[m])}</div>
                    <div className="text-xs text-stone-500">{METHOD_LABEL[m]}</div>
                    {cash.tipsByMethod[m] > 0 && <div className="text-[11px] text-emerald-700">+ {money(cash.tipsByMethod[m])} propina</div>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-ink px-4 py-3 text-white">
              <span className="text-sm text-white/70">Total cobrado{cash.tipsCents > 0 && ` · propinas ${money(cash.tipsCents)}`}</span>
              <span className="font-display text-2xl font-semibold tabular-nums">{money(cash.totalCents)}</span>
            </div>
            <p className="mt-2 text-xs text-stone-500">Para cuadrar la caja: el efectivo ({money(cash.byMethod.cash + cash.tipsByMethod.cash)} con propinas) debe estar en tu cartera o cajón.</p>
            <h4 className="label mt-5">Cobros ({cash.payments.length})</h4>
            {cash.payments.length === 0 ? (
              <p className="text-sm text-stone-500">Ningún cobro registrado en este turno.</p>
            ) : (
              <ul className="divide-y divide-stone-100 rounded-2xl ring-1 ring-stone-200/70">
                {cash.payments.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span><b>Mesa {p.tableLabel}</b> <span className="text-stone-500">· {hour(p.at)} · {METHOD_LABEL[p.method]}</span></span>
                    <span className="tabular-nums">{money(p.amountCents)}{p.tipCents > 0 && <span className="text-xs text-emerald-700"> +{money(p.tipCents)}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

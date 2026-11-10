"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, Loader2, Minus, Plus, TriangleAlert, X } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Marca de la app. */
export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display text-xl font-semibold", light ? "text-white" : "text-ink", className)}>
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white shadow-glow">R</span>
      Res<span className="-ml-2 text-brand-500">AN</span>
    </span>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

function Portal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  return el ? createPortal(children, el) : null;
}

/** Hoja inferior en móvil, modal centrado en escritorio. */
export function Sheet({
  open,
  onClose,
  children,
  className,
  title,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <Portal>
      <SheetInner onClose={onClose} className={className} title={title} wide={wide}>{children}</SheetInner>
    </Portal>
  );
}
function SheetInner({ onClose, children, className, title, wide }: { onClose: () => void; children: ReactNode; className?: string; title?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 animate-fade-in bg-ink/45 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cx(
          "relative max-h-[92dvh] w-full animate-sheet-up overflow-y-auto rounded-t-[28px] bg-white shadow-lift sm:animate-scale-in sm:rounded-[28px]",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-2.5 sm:hidden"><span className="h-1.5 w-10 rounded-full bg-stone-300/90" /></div>
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 pt-6 pb-1 sm:pt-5">
            <h3 className="font-display text-2xl font-semibold">{title}</h3>
            <button className="btn-icon bg-stone-100 text-stone-600 hover:bg-stone-200" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Panel lateral derecho. */
export function Drawer({ open, onClose, children, title, subtitle }: { open: boolean; onClose: () => void; children: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  if (!open) return null;
  return (
    <Portal>
      <DrawerInner onClose={onClose} title={title} subtitle={subtitle}>{children}</DrawerInner>
    </Portal>
  );
}
function DrawerInner({ onClose, children, title, subtitle }: { onClose: () => void; children: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal>
      <div className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg animate-slide-in-right flex-col bg-cream shadow-lift">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200/70 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-semibold">{title}</h2>
            {subtitle && <div className="text-sm text-stone-500">{subtitle}</div>}
          </div>
          <button className="btn-icon bg-stone-100 text-stone-600 hover:bg-stone-200" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

type ToastKind = "ok" | "info" | "error";
/** Avisos breves apilados arriba. */
export function useToast() {
  const [items, setItems] = useState<{ id: number; text: string; kind: ToastKind }[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, kind: ToastKind = "ok") => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 2800);
  }, []);
  const node = (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => {
        const Icon = t.kind === "ok" ? CheckCircle2 : t.kind === "error" ? TriangleAlert : Info;
        return (
          <div key={t.id} className="flex max-w-md animate-fade-up items-center gap-2.5 rounded-2xl bg-ink/95 py-2.5 pr-4 pl-3 text-sm font-medium text-white shadow-lift backdrop-blur">
            <Icon className={cx("size-5 shrink-0", t.kind === "ok" ? "text-emerald-400" : t.kind === "error" ? "text-red-400" : "text-sky-300")} />
            {t.text}
          </div>
        );
      })}
    </div>
  );
  return { show, node };
}

/** Selector de cantidad −/+. */
export function Stepper({ value, onChange, max = 20, size = "md", dark }: { value: number; onChange: (v: number) => void; max?: number; size?: "sm" | "md"; dark?: boolean }) {
  const s = size === "sm" ? "size-7" : "size-9";
  return (
    <div className={cx("inline-flex items-center gap-1 rounded-full p-1", dark ? "bg-ink text-white" : "bg-stone-100")}>
      <button type="button" className={cx(s, "grid place-items-center rounded-full transition active:scale-90", dark ? "hover:bg-white/10" : "bg-white shadow-soft hover:bg-stone-50")} onClick={() => onChange(value - 1)} aria-label="Quitar uno">
        <Minus className="size-4" />
      </button>
      <span key={value} className="w-6 animate-pop text-center text-sm font-bold tabular-nums">{value}</span>
      <button type="button" disabled={value >= max} className={cx(s, "grid place-items-center rounded-full transition active:scale-90", dark ? "bg-white text-ink" : "bg-ink text-white")} onClick={() => onChange(value + 1)} aria-label="Añadir uno">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin", className)} />;
}

export function FullScreenLoader({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3 text-stone-500">
        <Spinner className="size-7 text-brand-500" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

/** Interruptor accesible. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-stone-200/80 bg-white p-3.5 transition hover:border-stone-300", disabled && "cursor-not-allowed opacity-60")}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-stone-500">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-stone-300 transition peer-checked:bg-emerald-500 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-100 after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

/** Control segmentado. */
export function Segmented<T extends string>({ value, onChange, options, className, dark }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string; dark?: boolean }) {
  return (
    <div className={cx("inline-flex rounded-2xl p-1", dark ? "bg-white/10" : "bg-stone-900/5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap transition",
            value === o.value ? (dark ? "bg-white text-ink shadow" : "bg-white text-ink shadow-soft") : dark ? "text-white/70 hover:text-white" : "text-stone-500 hover:text-stone-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex animate-fade-up items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-stone-300 bg-white/50 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-stone-100 text-stone-500">{icon}</div>
      <div className="font-semibold">{title}</div>
      {children && <div className="max-w-xs text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={cx("inline-grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white", className)} style={{ background: `linear-gradient(135deg, hsl(${h} 55% 55%), hsl(${(h + 40) % 360} 60% 40%))` }}>
      {initials}
    </span>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart3, CalendarDays, ChefHat, LayoutGrid, LogOut, Settings2, VolumeX } from "lucide-react";
import { StaffGate, useStaff } from "@/lib/staff-auth";
import { Avatar, Logo, cx } from "@/components/ui";

export const ROLE_LABEL = { owner: "Propietario", manager: "Encargado", waiter: "Camarero", kitchen: "Cocina" } as const;

function Nav({ dark }: { dark?: boolean }) {
  const { me, can, logout } = useStaff();
  const path = usePathname();
  const links = [
    can("tables.view") && me.features.waiterView && { href: "/staff/floor", label: "Sala", icon: LayoutGrid },
    can("kitchen.view") && me.features.kitchenDisplay && { href: "/staff/kitchen", label: "Cocina", icon: ChefHat },
    can("reservations.view") && { href: "/staff/reservations", label: "Reservas", icon: CalendarDays },
    can("stats.view") && { href: "/staff/dashboard", label: "Panel", icon: BarChart3 },
    (can("menu.edit") || can("tables.manage") || can("users.manage") || can("service.settings")) && { href: "/staff/admin", label: "Gestión", icon: Settings2 },
  ].filter(Boolean) as { href: string; label: string; icon: typeof ChefHat }[];
  return (
    <header className={cx("no-print sticky top-0 z-30 border-b backdrop-blur-xl", dark ? "border-white/10 bg-stone-950/80 text-white" : "border-stone-200/70 bg-white/80")}>
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4">
        <Logo light={dark} className="hidden text-lg sm:inline-flex" />
        <span className={cx("hidden h-6 w-px sm:block", dark ? "bg-white/15" : "bg-stone-200")} />
        <b className="truncate font-display text-lg">{me.venueName}</b>
        <nav className={cx("ml-2 flex gap-1 rounded-2xl p-1", dark ? "bg-white/5" : "bg-stone-900/5")}>
          {links.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cx(
                  "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition",
                  active ? (dark ? "bg-white text-ink" : "bg-white text-ink shadow-soft") : dark ? "text-white/60 hover:text-white" : "text-stone-500 hover:text-ink",
                )}
              >
                <l.icon className="size-4" />
                <span className="hidden md:inline">{l.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-semibold">{me.name}</div>
            <div className={cx("text-xs", dark ? "text-white/50" : "text-stone-500")}>{ROLE_LABEL[me.role]}</div>
          </div>
          <Avatar name={me.name} />
          <button className={cx("btn-icon", dark ? "text-white/70 hover:bg-white/10" : "text-stone-500 hover:bg-stone-100")} onClick={logout} aria-label="Salir" title="Salir">
            <LogOut className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function StaffShell({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <StaffGate>
      <div className={cx("min-h-dvh", dark && "bg-stone-950 text-stone-100")}>
        <Nav dark={dark} />
        {children}
      </div>
    </StaffGate>
  );
}

/** El navegador silencia los avisos hasta el primer toque en la página. */
export function SoundHint({ on }: { on: boolean }) {
  if (on) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex animate-fade-up items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-ink shadow-lift">
        <VolumeX className="size-4" /> Toca la pantalla para activar los avisos sonoros
      </div>
    </div>
  );
}

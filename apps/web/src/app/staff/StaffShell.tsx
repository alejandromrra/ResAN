"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChefHat, LayoutGrid, LogOut, Settings2 } from "lucide-react";
import { StaffGate, useStaff } from "@/lib/staff-auth";
import { Avatar, Logo, cx } from "@/components/ui";

export const ROLE_LABEL = { owner: "Propietario", manager: "Encargado", waiter: "Camarero", kitchen: "Cocina" } as const;

function Nav({ dark }: { dark?: boolean }) {
  const { me, can, logout } = useStaff();
  const path = usePathname();
  const links = [
    can("tables.view") && me.features.waiterView && { href: "/staff/floor", label: "Sala", icon: LayoutGrid },
    can("kitchen.view") && me.features.kitchenDisplay && { href: "/staff/kitchen", label: "Cocina", icon: ChefHat },
    (can("menu.edit") || can("tables.manage") || can("users.manage")) && { href: "/staff/admin", label: "Gestión", icon: Settings2 },
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

/** Pantalla previa al turno: el navegador exige un gesto para permitir sonido. */
export function StartShift({ title, text, icon, onStart, dark }: { title: string; text: string; icon: ReactNode; onStart: () => void; dark?: boolean }) {
  return (
    <div className="grid min-h-[calc(100dvh-4rem)] place-items-center p-6">
      <div className={cx("w-full max-w-sm animate-scale-in rounded-[32px] p-8 text-center", dark ? "bg-white/5 ring-1 ring-white/10" : "card shadow-lift")}>
        <div className="mx-auto mb-5 grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-glow">{icon}</div>
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        <p className={cx("mt-2 text-sm", dark ? "text-white/60" : "text-stone-500")}>{text}</p>
        <button className="btn btn-primary btn-lg mt-6 w-full" onClick={onStart}>Iniciar turno</button>
      </div>
    </div>
  );
}

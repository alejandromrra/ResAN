"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StaffGate, useStaff } from "@/lib/staff-auth";

const ROLE_LABEL = { owner: "Propietario", manager: "Encargado", waiter: "Camarero", kitchen: "Cocina" } as const;

function Nav() {
  const { me, can, logout } = useStaff();
  const path = usePathname();
  const links = [
    can("kitchen.view") && me.features.kitchenDisplay && { href: "/staff/kitchen", label: "Cocina" },
    can("tables.view") && me.features.waiterView && { href: "/staff/floor", label: "Sala" },
    (can("menu.edit") || can("tables.manage") || can("users.manage")) && { href: "/staff/admin", label: "Administración" },
  ].filter(Boolean) as { href: string; label: string }[];
  return (
    <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2">
      <b className="text-brand">{me.venueName}</b>
      <nav className="flex gap-1">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${path.startsWith(l.href) ? "bg-brand text-white" : "text-stone-700 hover:bg-stone-100"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span className="ml-auto hidden text-xs text-stone-500 sm:block">{me.name} · {ROLE_LABEL[me.role]}</span>
      <button className="btn btn-ghost !px-3 !py-1.5" onClick={logout}>Salir</button>
    </header>
  );
}

export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <StaffGate>
      <Nav />
      {children}
    </StaffGate>
  );
}

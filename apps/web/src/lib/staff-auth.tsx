"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { can, type Permission, type StaffMeDTO } from "@resan/shared";
import { api } from "./api";

const KEY = "resan.staff.token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* modo privado */
  }
}

interface StaffCtx {
  token: string;
  me: StaffMeDTO;
  can: (p: Permission) => boolean;
  logout: () => void;
}
const Ctx = createContext<StaffCtx | null>(null);
export const useStaff = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStaff fuera de StaffGate");
  return v;
};

/** Exige sesión de personal; redirige a /staff/login si no hay o ha caducado. */
export function StaffGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ token: string; me: StaffMeDTO } | null>(null);

  const logout = useCallback(() => {
    storeToken(null);
    router.replace("/staff/login");
  }, [router]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return router.replace("/staff/login");
    api<StaffMeDTO>("/staff/me", { token })
      .then((me) => setState({ token, me }))
      .catch(() => logout());
  }, [router, logout]);

  if (!state) return <p className="p-6 text-neutral-500">Cargando…</p>;
  return (
    <Ctx.Provider value={{ ...state, can: (p) => can(state.me.role, p), logout }}>{children}</Ctx.Provider>
  );
}

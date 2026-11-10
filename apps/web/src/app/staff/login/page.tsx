"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LoginResponseDTO } from "@resan/shared";
import { api, errorText } from "@/lib/api";
import { storeToken } from "@/lib/staff-auth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [venue, setVenue] = useState("demo");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "pin"
          ? await api<LoginResponseDTO>("/auth/pin", { body: { venueSlug: venue.trim(), pin } })
          : await api<LoginResponseDTO>("/auth/login", { body: { email, password } });
      storeToken(r.token);
      router.replace("/staff");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl font-bold text-brand">ResAN · Personal</h1>
      <div className="mt-5 grid grid-cols-2 rounded-xl bg-stone-200 p-1 text-sm font-medium">
        {(["pin", "email"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-lg py-2 ${mode === m ? "bg-white shadow" : "text-stone-600"}`}>
            {m === "pin" ? "PIN (sala/cocina)" : "Correo (admin)"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-5 space-y-3">
        {mode === "pin" ? (
          <>
            <label className="block text-sm">Local
              <input className="input mt-1" value={venue} onChange={(e) => setVenue(e.target.value)} autoCapitalize="none" />
            </label>
            <label className="block text-sm">PIN
              <input className="input mt-1 text-center text-2xl tracking-[.5em]" inputMode="numeric" type="password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm">Correo
              <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
            </label>
            <label className="block text-sm">Contraseña
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        )}
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button className="btn btn-primary w-full !py-3" disabled={busy}>Entrar</button>
      </form>
      <p className="mt-6 text-xs text-stone-500">Demo: local <code>demo</code> · camarero PIN 1111 · cocina PIN 2222 · encargado@demo.resan.app / demo1234</p>
    </main>
  );
}

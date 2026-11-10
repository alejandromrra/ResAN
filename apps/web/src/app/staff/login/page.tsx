"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LoginResponseDTO } from "@resan/shared";
import { Delete, KeyRound, Mail } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { storeToken } from "@/lib/staff-auth";
import { ErrorBanner, Logo, Segmented, Spinner, cx } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [venue, setVenue] = useState("demo");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e?: React.FormEvent, pinValue = pin) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "pin"
          ? await api<LoginResponseDTO>("/auth/pin", { body: { venueSlug: venue.trim(), pin: pinValue } })
          : await api<LoginResponseDTO>("/auth/login", { body: { email, password } });
      storeToken(r.token);
      router.replace("/staff");
    } catch (err) {
      setError(errorText(err));
      setPin("");
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
    setError(null);
  };

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-32 -left-24 size-[28rem] rounded-full bg-brand-500/40 blur-3xl" />
        <div className="pointer-events-none absolute right-0 bottom-0 size-[24rem] rounded-full bg-gold/20 blur-3xl" />
        <Logo light className="relative" />
        <div className="relative mt-auto max-w-md">
          <h1 className="font-display text-5xl leading-[1.05] font-semibold">El servicio de sala, <em className="text-brand-300">en sincronía</em>.</h1>
          <p className="mt-4 text-white/60">Cocina, sala y caja ven lo mismo al instante: cada pedido de cada mesa, cada llamada y cada cuenta.</p>
        </div>
        <div className="relative mt-10 grid grid-cols-3 gap-3 text-sm">
          {[["Sala", "Mesas en vivo"], ["Cocina", "Comandas por estado"], ["Gestión", "Carta, QR y equipo"]].map(([a, b]) => (
            <div key={a} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur"><b className="block">{a}</b><span className="text-white/50">{b}</span></div>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <Logo className="mb-8 lg:hidden" />
          <h2 className="font-display text-3xl font-semibold">Acceso del personal</h2>
          <p className="mt-1 text-sm text-stone-500">Elige cómo quieres entrar.</p>

          <Segmented
            className="mt-6 w-full"
            value={mode}
            onChange={(m) => { setMode(m); setError(null); }}
            options={[
              { value: "pin", label: <><KeyRound className="size-4" /> PIN</> },
              { value: "email", label: <><Mail className="size-4" /> Correo</> },
            ]}
          />

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "pin" ? (
              <>
                <label className="block">
                  <span className="label">Local</span>
                  <input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} autoCapitalize="none" />
                </label>
                <div key={shake} className={cx("flex justify-center gap-3 py-2", shake > 0 && "animate-wiggle")}>
                  {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                    <span key={i} className={cx("size-4 rounded-full transition-all duration-200", i < pin.length ? "scale-110 bg-ink" : "bg-stone-200")} />
                  ))}
                </div>
                <input className="sr-only" aria-label="PIN" inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} autoFocus />
                <div className="grid grid-cols-3 gap-2.5">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <button type="button" key={d} onClick={() => press(d)} className="h-16 rounded-2xl bg-white font-display text-2xl font-semibold shadow-soft ring-1 ring-stone-200/70 transition hover:bg-stone-50 active:scale-95 active:bg-stone-100">{d}</button>
                  ))}
                  <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} className="grid h-16 place-items-center rounded-2xl text-stone-500 transition hover:bg-stone-900/5 active:scale-95" aria-label="Borrar"><Delete className="size-6" /></button>
                  <button type="button" onClick={() => press("0")} className="h-16 rounded-2xl bg-white font-display text-2xl font-semibold shadow-soft ring-1 ring-stone-200/70 transition hover:bg-stone-50 active:scale-95">0</button>
                  <button className="btn btn-primary h-16 rounded-2xl" disabled={busy || pin.length < 4}>{busy ? <Spinner /> : "Entrar"}</button>
                </div>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="label">Correo</span>
                  <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" autoComplete="username" />
                </label>
                <label className="block">
                  <span className="label">Contraseña</span>
                  <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </label>
                <button className="btn btn-primary btn-lg w-full" disabled={busy}>{busy ? <Spinner /> : "Entrar"}</button>
              </>
            )}
            <ErrorBanner>{error}</ErrorBanner>
          </form>

          <div className="mt-8 rounded-2xl border border-dashed border-stone-300 p-3 text-xs text-stone-500">
            <b className="text-stone-700">Demo</b> · local <code>demo</code> · camarero <code>1111</code> · cocina <code>2222</code> · encargado@demo.resan.app / demo1234
          </div>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { ArrowRight, BellRing, ChefHat, CreditCard, Globe, QrCode, Settings2, Smartphone, Users } from "lucide-react";
import { Logo } from "@/components/ui";

const STEPS = [
  { icon: QrCode, title: "Escanea y descubre", text: "La carta de la mesa con fotos, en 6 idiomas, con alérgenos y etiquetas." },
  { icon: Users, title: "Toda la mesa pide", text: "Cada comensal desde su móvil, en varias rondas y con estado en vivo. Puede llamar al camarero o pedir la cuenta." },
  { icon: ChefHat, title: "Cocina y sala, en sincronía", text: "Cocina ve solo lo que se cocina; sala, bebidas, postres y platos listos, con aviso sonoro." },
  { icon: CreditCard, title: "Cuenta y cobro", text: "Se imprime la cuenta, se cobra en el datáfono del local y se registra el pago. La mesa se cierra sola." },
  { icon: Settings2, title: "Gestión del local", text: "Carta, mesas con QR imprimible, equipo con PIN y módulos activables por local." },
];

export default function Home() {
  return (
    <main className="min-h-dvh">
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="pointer-events-none absolute -top-40 -right-20 size-[36rem] rounded-full bg-brand-500/35 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 size-[30rem] rounded-full bg-gold/20 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-center justify-between">
            <Logo light />
            <Link href="/staff/login" className="btn bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20">Acceso del personal</Link>
          </div>
          <div className="grid items-center gap-12 py-20 lg:grid-cols-[1.2fr_1fr]">
            <div className="animate-fade-up">
              <span className="chip bg-white/10! text-white/80! ring-1 ring-white/15"><Smartphone className="size-3" /> Carta QR · pedidos en mesa</span>
              <h1 className="mt-5 font-display text-5xl leading-[1.02] font-semibold sm:text-6xl">
                Del QR a la cuenta, <em className="text-brand-300">sin esperas</em>.
              </h1>
              <p className="mt-5 max-w-lg text-lg text-white/60">
                Un SaaS multi-restaurante con módulos activables: sirve igual para un bar pequeño que para una cadena.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/staff/login" className="btn btn-primary btn-lg">Entrar al panel <ArrowRight className="size-5" /></Link>
              </div>
              <p className="mt-6 text-sm text-white/40">Los comensales entran escaneando el QR de su mesa (<code>/q/&lt;token&gt;</code>). Los QR se imprimen en Gestión → Mesas y QR.</p>
            </div>
            <div className="relative mx-auto hidden w-72 animate-scale-in lg:block">
              <div className="rotate-2 rounded-[44px] bg-stone-800 p-3 shadow-2xl ring-1 ring-white/10">
                <div className="overflow-hidden rounded-[34px] bg-cream text-ink">
                  <div className="bg-ink px-5 pt-6 pb-10 text-white">
                    <span className="chip bg-white/10! text-white/80!">Mesa 4</span>
                    <div className="mt-4 font-display text-2xl font-semibold">Bar Demo</div>
                  </div>
                  <div className="-mt-6 space-y-2.5 px-3 pb-5">
                    {[["Croquetas de jamón", "8,50 €", "/demo/croquetas.svg"], ["Paella mixta", "14,00 €", "/demo/paella.svg"], ["Tarta de queso", "5,50 €", "/demo/tarta.svg"]].map(([n, p, img]) => (
                      <div key={n} className="card flex items-center gap-2.5 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt="" className="size-12 rounded-lg object-cover" />
                        <div className="flex-1 text-xs"><b className="block">{n}</b><span className="text-stone-500">{p}</span></div>
                        <span className="grid size-7 place-items-center rounded-full bg-ink text-sm text-white">+</span>
                      </div>
                    ))}
                    <div className="btn btn-primary w-full justify-between text-xs"><span>Tu pedido · 3</span><span>28,00 €</span></div>
                  </div>
                </div>
              </div>
              <div className="absolute top-24 -left-16 flex animate-fade-up items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-ink shadow-lift [animation-delay:400ms]">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><ChefHat className="size-4" /></span> Mesa 4 · listo
              </div>
              <div className="absolute -right-12 bottom-24 flex animate-fade-up items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-ink shadow-lift [animation-delay:600ms]">
                <span className="grid size-7 place-items-center rounded-lg bg-red-50 text-red-600"><BellRing className="size-4" /></span> Mesa 2 llama
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-4xl font-semibold">Todo el servicio, en un flujo</h2>
        <p className="mt-2 text-stone-500">Cada local es un tenant con sus propios módulos.</p>
        <ol className="mt-10 grid gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card card-hover animate-fade-up p-5" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><s.icon className="size-5" /></span>
                <span className="font-display text-3xl font-semibold text-stone-200">{i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-stone-500">{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="font-display text-2xl font-semibold">Modos de pedido</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-600">
              <li><b className="text-ink">Directo</b> · el pedido entra en cocina al enviarlo.</li>
              <li><b className="text-ink">Con aprobación</b> · lo valida el camarero.</li>
              <li><b className="text-ink">Solo carta</b> · consulta y llamada al camarero.</li>
            </ul>
          </div>
          <div className="card p-6">
            <h3 className="font-display text-2xl font-semibold">Apertura de mesa</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-600">
              <li><b className="text-ink">Automática</b> · al escanear y pedir.</li>
              <li><b className="text-ink">Por el camarero</b> · desde la vista de sala.</li>
              <li className="flex items-center gap-1.5"><Globe className="size-4" /> Español, català, English, français, italiano, Deutsch.</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

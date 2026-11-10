import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold text-brand">ResAN</h1>
      <p className="mt-2 text-stone-600">Carta QR, pedidos en mesa, cocina y sala para restaurantes.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/staff/login" className="btn btn-primary">Acceso del personal</Link>
      </div>
      <p className="mt-6 text-sm text-stone-500">
        Los comensales entran escaneando el QR de su mesa (<code>/q/&lt;token&gt;</code>). En desarrollo, los QR de las mesas
        demo se imprimen desde Administración → Mesas.
      </p>
    </main>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatMoney, type BillDTO } from "@resan/shared";
import { api, errorText } from "@/lib/api";
import { getStoredToken } from "@/lib/staff-auth";
import { FullScreenLoader } from "@/components/ui";

/** Cuenta para el cliente. No es una factura ni un ticket fiscal. */
export default function PrintBill() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<BillDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BillDTO>(`/staff/bills/${id}`, { token: getStoredToken() })
      .then((b) => { setBill(b); setTimeout(() => window.print(), 300); })
      .catch((e) => setError(errorText(e)));
  }, [id]);

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!bill) return <FullScreenLoader />;
  const m = (c: number) => formatMoney(c, "es");
  return (
    <div className="min-h-dvh py-8 print:py-0">
    <div className="no-print mx-auto mb-4 flex max-w-[80mm] justify-end"><button className="btn btn-dark btn-sm" onClick={() => window.print()}>Imprimir</button></div>
    <main className="mx-auto max-w-[80mm] bg-white p-5 font-mono text-sm shadow-lift print:p-0 print:shadow-none">
      <h1 className="text-center text-lg font-bold">{bill.venueName}</h1>
      <p className="text-center">Mesa {bill.tableLabel} · {new Date(bill.createdAt).toLocaleString("es-ES")}</p>
      <hr className="my-2 border-dashed" />
      <table className="w-full">
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-0.5">{l.qty}× {l.name}</td>
              <td className="py-0.5 text-right">{m(l.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-2 border-dashed" />
      {bill.discountCents > 0 && <div className="flex justify-between"><span>Descuento</span><span>-{m(bill.discountCents)}</span></div>}
      <div className="flex justify-between text-base font-bold"><span>TOTAL (IVA incl.)</span><span>{m(bill.totalCents)}</span></div>
      {bill.byGuest.length > 1 && (
        <>
          <hr className="my-2 border-dashed" />
          <p className="font-bold">Por comensal</p>
          {bill.byGuest.map((g, i) => <div key={i} className="flex justify-between"><span>{g.alias ?? "Mesa"}</span><span>{m(g.totalCents)}</span></div>)}
        </>
      )}
      <hr className="my-2 border-dashed" />
      <p className="text-center text-xs">Documento de consulta, no es una factura. Solicite factura si la necesita.</p>
    </main>
    </div>
  );
}

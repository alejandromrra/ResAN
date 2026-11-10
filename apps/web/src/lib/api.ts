export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.details);
  return data as T;
}

/** Texto legible para errores de la API (se muestran al personal; el cliente usa sus propias cadenas). */
const ERRORS: Record<string, string> = {
  invalid_credentials: "Credenciales incorrectas",
  transition_not_allowed: "No tienes permiso para ese cambio",
  pin_in_use: "Ese PIN ya lo usa otra persona del local",
  last_owner: "Debe quedar al menos un propietario",
  bill_outdated: "Se ha pedido algo después de generar la cuenta; vuelve a generarla",
  amount_exceeds_due: "El importe supera lo pendiente",
  nothing_to_bill: "No hay consumo que cobrar",
  item_unavailable: "Plato agotado",
  feature_disabled: "Este módulo no está activado en el local",
};
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return ERRORS[e.code] ?? `Error: ${e.code}`;
  return "No se pudo conectar con el servidor";
}

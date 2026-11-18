/**
 * Dirección de la API.
 * - NEXT_PUBLIC_API_URL relativa ("/api"): mismo dominio que la web (despliegue con Docker / Easypanel).
 * - NEXT_PUBLIC_API_URL absoluta: se usa tal cual.
 * - Sin definir (desarrollo): el mismo host desde el que se abre la web, en el puerto 4000. Así, abriendo
 *   http://<IP-del-ordenador>:3000 desde un móvil de la misma red, la carta funciona sin configurar nada.
 */
function resolveApiUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  if (env) return (env.startsWith("/") ? origin + env : env).replace(/\/+$/, "");
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:4000`;
  return "http://localhost:4000";
}
export const API_URL = resolveApiUrl();

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
  shift_closed: "El turno está cerrado",
  shift_already_open: "Ya hay un turno abierto",
  open_tables: "Quedan mesas abiertas",
  no_shift: "Aún no hay turnos",
  table_in_use: "La mesa está ocupada: ciérrala antes de eliminarla",
  email_in_use: "Ese correo ya lo usa otra persona",
  user_shared_with_other_venue: "Esta persona trabaja también en otro local: sus datos de acceso solo los puede cambiar ella",
  only_owner_can_touch_owner: "Solo el propietario puede modificar a otro propietario",
  table_label_taken: "Ya hay una mesa con ese nombre",
  already_assigned: "Otra persona ya ha cogido esa mesa",
  venue_not_empty: "El local ya tiene carta o mesas: los datos de ejemplo solo se cargan en un local vacío",
};
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return ERRORS[e.code] ?? `Error: ${e.code}`;
  return "No se pudo conectar con el servidor";
}

/**
 * Identificador aleatorio. crypto.randomUUID solo existe en contextos seguros (https o localhost):
 * abriendo la web por IP con http no está disponible, así que hay respaldo.
 */
export const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

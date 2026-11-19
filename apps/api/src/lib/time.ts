/** Fechas y horas en la zona horaria del local (sin dependencias). */

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha (YYYY-MM-DD), hora (HH:MM) y día de la semana (0 = lunes) de un instante en `tz`. */
export function localParts(at: Date, tz: string): { date: string; time: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday!);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday };
}

/** Minutos que `tz` va por delante de UTC en ese instante. */
function offsetMinutes(at: Date, tz: string): number {
  const p = localParts(at, tz);
  const [y, m, d] = p.date.split("-").map(Number);
  const [h, mi] = p.time.split(":").map(Number);
  const asUtc = Date.UTC(y!, m! - 1, d!, h!, mi!);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Instante que corresponde a `date` `time` en la zona `tz`. */
export function zonedTime(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, h!, mi!);
  let at = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
  // Segundo ajuste por si el cambio de hora cae entre medias
  at = new Date(guess - offsetMinutes(at, tz) * 60000);
  return at;
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** "13:00-16:00, 20:00-23:30" → [[780, 960], [1200, 1410]]. Ignora tramos mal escritos. */
export function parseHours(text: string): [number, number][] {
  return text
    .split(/[,;]/)
    .map((r) => r.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => {
      const a = Number(m[1]) * 60 + Number(m[2]);
      let b = Number(m[3]) * 60 + Number(m[4]);
      if (b <= a) b += 24 * 60; // hasta pasada la medianoche
      return [a, b] as [number, number];
    });
}

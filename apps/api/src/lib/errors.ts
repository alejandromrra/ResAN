export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, details?: unknown) => new HttpError(400, code, undefined, details);
export const unauthorized = (code = "unauthorized") => new HttpError(401, code);
export const forbidden = (code = "forbidden", details?: unknown) => new HttpError(403, code, undefined, details);
export const notFound = (code = "not_found") => new HttpError(404, code);
export const conflict = (code: string, details?: unknown) => new HttpError(409, code, undefined, details);
export const gone = (code: string) => new HttpError(410, code);
export const unprocessable = (code: string, details?: unknown) => new HttpError(422, code, undefined, details);

/** Detecta una violación de índice único de Postgres, también cuando Drizzle envuelve el error. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

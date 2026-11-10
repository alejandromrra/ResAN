import { randomBytes } from "node:crypto";

/** Token aleatorio e impredecible para los QR de mesa (128 bits). */
export function newQrToken(): string {
  return randomBytes(16).toString("base64url");
}

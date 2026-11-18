import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * En desarrollo Next.js bloquea sus scripts y la recarga en caliente si la web se abre desde
 * otra dirección que no sea localhost (p. ej. http://192.168.1.50:3000 desde el móvil), y la
 * página queda sin interactividad. Se permiten las IP de este ordenador y las de ALLOWED_DEV_ORIGINS.
 */
const localIps = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);
const extra = (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const config: NextConfig = {
  transpilePackages: ["@resan/shared"],
  reactStrictMode: true,
  allowedDevOrigins: [...localIps, ...extra, "*.local"],
  // Servidor autocontenido para la imagen Docker (.next/standalone)
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
};

export default config;

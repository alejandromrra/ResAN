// Arranca la web (Next.js, interna) y la API (pública). Si uno de los dos cae, se para el
// contenedor para que Easypanel/Docker lo reinicie entero.
import { spawn } from "node:child_process";

const webPort = process.env.WEB_PORT ?? "3100";
const children = [];
let stopping = false;

function run(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[resan] ${name} terminó (${signal ?? code}); parando el contenedor`);
    stop(code || 1);
  });
  children.push(child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 8000).unref();
  Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null ? r() : c.on("exit", r))))).then(() => process.exit(code));
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

// La web solo escucha dentro del contenedor; el acceso entra por la API
run("web", "node", ["server.js"], {
  cwd: "/app/web/apps/web",
  env: { ...process.env, PORT: webPort, HOSTNAME: "127.0.0.1" },
});
run("api", "node", ["--import", "tsx", "src/server.ts"], { cwd: "/app/apps/api", env: process.env });

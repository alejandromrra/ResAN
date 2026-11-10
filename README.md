# ResAN

SaaS multi-local de **carta QR y pedidos en mesa** para restauración: el comensal escanea el QR de su mesa, ve la carta con fotos, pide desde el móvil (varios comensales, varias rondas, en vivo), cocina ve lo que hay que cocinar, sala ve lo que hay que llevar, y el camarero imprime la cuenta y registra el cobro hecho en el datáfono del propio local.

> Estado: **MVP fase 1**. Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para qué está hecho, qué falta y las decisiones tomadas. Informe de producto completo: [Google Doc](https://docs.google.com/document/d/1omyz-I-hrRp_5CagYz-JsY97XEK93EpDNSJQBXa8Mj0).

## Arranque rápido

Requisitos: Node 22+ y pnpm 10. No hace falta Docker: sin `DATABASE_URL` la API usa Postgres embebido (PGlite).

```bash
pnpm install
SEED_DEMO=true pnpm dev   # API en :4000, web en :3000 (variables en .env.example)
```

`SEED_DEMO=true` crea el local `demo` (solo para desarrollo). Entra en http://localhost:3000/staff/login:

| Rol | Acceso |
|---|---|
| Camarero | local `demo`, PIN `1111` |
| Cocina | local `demo`, PIN `2222` |
| Encargado | `encargado@demo.resan.app` / `demo1234` |
| Propietario | `owner@demo.resan.app` / `demo1234` |

Los QR de las mesas se imprimen en Administración → Mesas y QR (apuntan a `/q/<token>`).

Con Postgres real: `docker compose up -d` y `DATABASE_URL=postgres://resan:resan@localhost:5432/resan`.

## Estructura

- `apps/api` Fastify 5 + Drizzle + Zod, WebSocket para tiempo real.
- `apps/web` Next.js 16 + React 19 + Tailwind 4 (carta del comensal, cocina, sala, administración).
- `packages/shared` tipos, RBAC, máquina de estados, i18n y eventos compartidos.

## Comandos

`pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm db:generate` (migraciones) · `pnpm db:seed`

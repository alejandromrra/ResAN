# ResAN

SaaS multi-local de **carta QR y pedidos en mesa** para restauración: el comensal escanea el QR de su mesa, ve la carta con fotos, pide desde el móvil (varios comensales, varias rondas, en vivo), cocina ve lo que hay que cocinar, sala ve lo que hay que llevar, y el camarero imprime la cuenta y registra el cobro hecho en el datáfono del propio local.

> Estado: **MVP fase 1**. Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para qué está hecho, qué falta y las decisiones tomadas. Informe de producto completo: [Google Doc](https://docs.google.com/document/d/1omyz-I-hrRp_5CagYz-JsY97XEK93EpDNSJQBXa8Mj0).

## Publicar en Easypanel

Una sola imagen Docker sirve la web y la API por el **puerto 3000** (la API cuelga de `/api`, el tiempo real de `/api/ws`).

1. **Base de datos** — En tu proyecto de Easypanel: *+ Service → Postgres*. Llámalo `resan-db`.
   Copia su **Internal Connection URL** (empieza por `postgres://`).
2. **App** — *+ Service → App*, llámala `resan`.
   - *Source*: GitHub → este repositorio y la rama a desplegar.
     (Si el repositorio es privado, conecta antes tu GitHub en *Settings → GitHub* de Easypanel.)
   - *Build*: **Dockerfile** (ruta `Dockerfile`).
   - *Environment*:
     ```
     DATABASE_URL=<la Internal Connection URL del paso 1>
     JWT_SECRET=<cadena aleatoria de 32+ caracteres>
     VENUE_NAME=Nombre de tu local
     OWNER_EMAIL=tu@correo.es
     OWNER_PASSWORD=<contraseña de 8+ caracteres>
     ```
     Para generar `JWT_SECRET`: `openssl rand -base64 48`.
   - *Domains*: deja el dominio que te propone Easypanel (o el tuyo) y pon el puerto **3000**.
   - Pulsa **Deploy**.
3. Abre la URL → *Acceso del personal* → *Correo* y entra con `OWNER_EMAIL` / `OWNER_PASSWORD`.
   En **Gestión** crea la carta, las mesas (imprime sus QR), el equipo con sus PIN y elige los módulos.
   El personal de sala y cocina entra con el **slug** del local (el nombre en minúsculas con guiones, p. ej. `bar-pepe`; aparece en Gestión → Equipo) y su PIN.

**Datos de ejemplo para una demo**: en Gestión → Carta (o Local y módulos) pulsa «Cargar datos de ejemplo». Rellena tu local con 14 platos con fotos en 6 idiomas, 9 mesas con QR, dos camareros (Laura, PIN `1111`; Pablo, PIN `3333`) y un cocinero (Marcos, PIN `2222`) y, si lo dejas marcado, el día en marcha: mesas ya cobradas con sus tiempos (para el panel del equipo), mesas abiertas con pedidos y retrasos, y una mesa recién abierta por un cliente esperando camarero. Solo funciona con el local vacío (sin carta ni mesas).

El local y el propietario se crean solo la primera vez: después puedes dejar o quitar esas variables, no se vuelven a aplicar ni cambian la contraseña.
Para actualizar, sube los cambios a GitHub y pulsa *Deploy* (o activa el auto-deploy). Las migraciones de la base de datos se aplican solas al arrancar.

Opcionales: `SEED_DEMO=true` crea además el local `demo` con datos de prueba (credenciales públicas: no lo uses con clientes reales); `RATE_LIMIT_MAX` (peticiones por minuto e IP a la API, 600 por defecto; súbelo si muchos comensales comparten la wifi del local).

## Desarrollo local

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

Los QR de las mesas se imprimen en Gestión → Mesas y QR (apuntan a `/q/<token>`).

### Probar la carta del comensal

- **En el ordenador**: Gestión → Mesas y QR → «Abrir carta» en cualquier mesa, o en Sala abre una mesa → «Ver la carta de esta mesa». Para simular varios comensales, ábrela también en una ventana de incógnito (cada navegador es un comensal distinto).
- **Con el móvil** (misma wifi): arranca normal (`SEED_DEMO=true pnpm dev`), abre el panel desde `http://<IP-del-ordenador>:3000` (la que Next muestra como «Network») y escanea un QR de Gestión → Mesas y QR: el QR usa la dirección desde la que abriste el panel. En desarrollo no hace falta tocar CORS ni `allowedDevOrigins`: se aceptan las IP de la red local. Si accedes con otro nombre (p. ej. un túnel), añádelo con `ALLOWED_DEV_ORIGINS=mi-host.ejemplo` y a `CORS_ORIGIN`.
- Al cambiar de `localhost` a la IP tendrás que volver a entrar con el PIN: el navegador guarda la sesión por dirección.

Con Postgres real: `docker compose up -d` y `DATABASE_URL=postgres://resan:resan@localhost:5432/resan`.

## Estructura

- `apps/api` Fastify 5 + Drizzle + Zod, WebSocket para tiempo real.
- `apps/web` Next.js 16 + React 19 + Tailwind 4 + lucide-react (carta del comensal, cocina, sala, administración).
- `packages/shared` tipos, RBAC, máquina de estados, i18n y eventos compartidos.

## Comandos

`pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm db:generate` (migraciones) · `pnpm db:seed`

# Arquitectura y estado (MVP fase 1)

Referencia de producto: [informe en Drive](https://docs.google.com/document/d/1omyz-I-hrRp_5CagYz-JsY97XEK93EpDNSJQBXa8Mj0). Este documento recoge lo implementado y las decisiones técnicas.

## Modelo

- **Multi-local**: `tenants → venues`; todas las tablas llevan `venue_id` y toda consulta de la API filtra por el local del token. Tests de aislamiento en `apps/api/src/test/security.test.ts`.
- **Mesa y sesión**: cada mesa tiene un QR con token regenerable. Una *sesión* abierta por mesa (índice único parcial). Los comensales se identifican por dispositivo (`guests`) y heredan el estado de la mesa. Al cobrarse la cuenta se cierra la sesión y los móviles dejan de poder pedir (410).
- **Pedidos**: cada envío es una *ronda*. Las líneas guardan nombre, precio e IVA como *snapshot*. Idempotencia por clave (reintentos de red sin duplicados).
- **Estados de línea** (`packages/shared/src/status.ts`): `pending_approval → new → preparing → ready → served` (+ `cancelled`). Las líneas `serve` (bebidas, postres) saltan cocina y aparecen directamente en sala. Cada rol solo puede hacer sus transiciones.
- **Modos de pedido por local**: directo, con aprobación del camarero, o solo carta.
- **Cuenta**: documento de consulta **no fiscal** (borrador → impresa → pagada), por comensal y total. Se invalida si se pide algo después de generarla (`bill_outdated`). Pagos manuales (tarjeta/efectivo/otro, propina) registrados tras cobrar en el datáfono del local.
- **Módulos activables** (`features`) con presets por plan; **roles** owner/manager/waiter/kitchen con matriz de permisos en `rbac.ts`.
- **Idiomas**: es, ca, en, fr, it, de. Traducciones de carta por plato con respaldo al idioma del local campo a campo; los 14 alérgenos UE son etiquetas fijas.

## Tiempo real

WebSocket `/ws` (autenticación con el primer mensaje). Eventos ligeros por local con número de secuencia y búfer de 200 para reanudar (`since`); si no se puede reanudar el servidor envía `resync` y el cliente recarga. Personal ve todo el local; el comensal solo su mesa. **Una sola instancia**: para escalar, sustituir `EventBus` por Redis pub/sub.

## Seguridad

Contraseñas y PIN con scrypt; JWT de 12 h; rate limit global y más estricto en login/PIN; CORS por lista. Los PIN son únicos dentro de un local.

## Pendiente respecto al informe

| Tema | Estado |
|---|---|
| Row Level Security en Postgres | **No implementado**: el aislamiento es a nivel de aplicación. Siguiente paso recomendado. |
| Subida de imágenes (S3/R2 + redimensionado) | Solo campo `imageUrl`; las del demo son placeholders SVG. |
| Modificadores, combos/menús | Fase 2. |
| Zona de clientes, ofertas, acumulación | Fase 2. |
| Estadísticas | Fase 2. |
| Dividir la cuenta por comensales (UI) | La API ya devuelve el total por comensal; falta UI de cobro parcial por persona. |
| Integración TPV / facturación Verifactu | Fase posterior. La cuenta de v1 no es factura ni ticket fiscal; las fechas de obligatoriedad de Verifactu (RD 1007/2023) deben verificarse con un asesor. |
| Traducciones de la interfaz | Propuestas por IA: revisar con hablantes nativos. |
| Pagos online / app de camareros nativa | Fuera de alcance de v1. |

## Interfaz

Tailwind 4 con tokens propios en `apps/web/src/app/globals.css` (paleta terracota/crema, tipografías Fraunces + Inter vía `next/font`, sombras y animaciones). Componentes base en `apps/web/src/components/ui.tsx` (hoja inferior/modal, panel lateral, avisos, selector de cantidad, interruptor, control segmentado) e iconos de `lucide-react`. Cocina usa tema oscuro tipo KDS; carta del comensal pensada para móvil (navegación por categorías con scroll, buscador, ficha de plato con alérgenos, seguimiento de la mesa por rondas).

## Revisión del flujo (ajustes)

- **Solo carta**: el comensal puede entrar en la mesa para llamar al camarero o pedir la cuenta (si el módulo de llamadas está activo); pedir sigue bloqueado (`view_only`).
- **Llamadas desactivadas**: la carta oculta los botones de llamar/pedir cuenta cuando el módulo `serviceCalls` está apagado.
- **Apertura por el camarero**: la carta del comensal se refresca sola mientras no está unido a la mesa, así ve que se ha abierto sin recargar.
- **Sala**: aviso sonoro también cuando entran bebidas/postres por llevar, no solo platos listos.
- **Liberar mesa**: el camarero puede cerrar una mesa abierta sin consumo (p. ej. alguien escaneó y llamó sin pedir); cerrar una mesa con consumo sin cobrar sigue reservado a encargado/propietario.
- **Cobro**: se puede cobrar una cuenta en borrador si está al día; si hay pedidos posteriores se pide actualizarla. Tras el pago completo se muestra la confirmación y la mesa queda libre.

## Asignación de mesas, retrasos y panel del equipo

- **Asignación**: `table_sessions.assigned_to` guarda quién lleva la mesa y `table_assignments` registra cada asignación (quién, cómo —`opened`, `claimed`, `auto`, `manager`—, quién la hizo y cuánto tardó desde que se abrió).
  - Si abre la mesa un camarero (o toma su pedido), la lleva él.
  - Si la abre un cliente desde el QR, se ofrece a los camareros **conectados** que menos mesas abiertas llevan (si no hay nadie conectado, a todos). Pueden cogerla con «Me la quedo».
  - Si en `CLAIM_TIMEOUT_MIN` (5 min) nadie la coge, una tarea del servidor (cada 30 s) la asigna al que menos mesas lleva; a igualdad, al que menos ha recibido en el día.
  - El encargado y el propietario pueden asignar o reasignar cualquier mesa (permiso `tables.assign`).
  - La presencia (quién está conectado) sale de los WebSocket abiertos del personal.
- **Retrasos** (`packages/shared/src/service.ts`, `apps/api/src/services/delays.ts`): se calculan al vuelo con las marcas de tiempo de cada plato (`started_at`, `ready_at`, `served_at`, `prepared_by`, `served_by`) y de las llamadas (`ack_at`, `done_at`). Umbrales: plato listo sin llevar 5 min, bebida sin llevar 5 min, pedido sin completar 25 min, llamada sin atender 3 min, pedido sin aprobar 3 min, comanda sin empezar 5 min, plato sin terminar 15 min. Sala ve los de sus mesas y los de las mesas sin camarero; cocina, los suyos; el encargado, todos.
- **Panel del equipo** (`/staff/dashboard`, permiso `stats.view`): por empleado y por turno: mesas y cómo se asignaron, platos servidos y tiempo medio en llevarlos, llamadas y tiempo de respuesta, cobros y propinas, platos preparados y tiempos de cocina, tareas fuera de tiempo y porcentaje a tiempo. El turno abierto se actualiza en vivo; los cerrados muestran el resumen guardado al cerrar.
- **Turnos** (`shifts`): solo el encargado o el propietario (permiso `shift.manage`) abren y cierran el turno desde Sala o Cocina. Sin turno abierto, camareros y cocina ven una pantalla de espera que se abre sola al empezar, y el cliente puede ver la carta pero no pedir, llamar ni abrir mesa (`shift_closed`). El turno solo se cierra sin mesas abiertas; al cerrarlo se guarda el resumen (`shifts.summary`) y el encargado lo ve en el panel. Los avisos sonoros se activan con el primer toque (exigencia de los navegadores) y la pantalla se mantiene encendida sola.
- **Caja del camarero** (`/staff/shift/cash`): lo cobrado en el turno por forma de pago (tarjeta, efectivo, otros), propinas y detalle por mesa. Disponible durante el turno («Mi caja») y en la pantalla de espera tras cerrarlo. El encargado ve la de cada uno en el resumen.

## Despliegue

`Dockerfile` en la raíz: una imagen con la web (Next.js `standalone`, escuchando solo en `127.0.0.1:3100`) y la API (Fastify, puerto público 3000). La API monta sus rutas bajo `API_PREFIX=/api` y reenvía el resto a la web (`WEB_UPSTREAM`), así hay un solo dominio, sin CORS, y el WebSocket va por `/api/ws`. `docker/start.mjs` arranca ambos procesos y para el contenedor si uno cae. `trustProxy` está activo en producción para que el límite de peticiones use la IP real detrás de Traefik. En producción es obligatorio `DATABASE_URL` (Postgres); el primer local se crea con `VENUE_NAME`, `OWNER_EMAIL` y `OWNER_PASSWORD`.

## Desarrollo

Sin `DATABASE_URL` se usa PGlite (en memoria, o en disco con `PGLITE_DIR`). Migraciones con `pnpm db:generate` (drizzle-kit) y se aplican al arrancar. Tests: `pnpm test` (Vitest con PGlite en memoria, sin servicios externos).

## Gestión

Desde Gestión se puede crear, editar, ordenar y eliminar categorías y platos (los pedidos antiguos conservan nombre y precio), editar y eliminar mesas (se ocultan para conservar el historial; su QR deja de funcionar y la etiqueta queda libre) y zonas, y editar nombre, correo, contraseña, rol y PIN del equipo (los datos de acceso de alguien que trabaja también en otro local solo los cambia esa persona).

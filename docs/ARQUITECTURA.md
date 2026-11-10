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

## Desarrollo

Sin `DATABASE_URL` se usa PGlite (en memoria, o en disco con `PGLITE_DIR`). Migraciones con `pnpm db:generate` (drizzle-kit) y se aplican al arrancar. Tests: `pnpm test` (Vitest con PGlite en memoria, sin servicios externos).

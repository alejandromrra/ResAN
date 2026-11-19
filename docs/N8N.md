# Agente de reservas con n8n

ResAN expone una API pequeña para que un flujo de n8n (por ejemplo, un **AI Agent** que atiende WhatsApp, Instagram o el teléfono) consulte huecos, reserve, cambie o cancele reservas y lea las **pautas del día** que pone el encargado.

## 1. Clave del local

En **Gestión → Reservas → Agente de reservas (n8n)** pulsa «Generar clave». Se muestra una sola vez (`rsn_…`); guárdala en n8n como credencial:

- Tipo **Header Auth**: nombre `Authorization`, valor `Bearer rsn_…`  
  (también vale la cabecera `X-Api-Key: rsn_…`).

Generar una clave nueva desactiva la anterior. «Desactivar» corta el acceso al agente.

Dirección base: `https://TU-DOMINIO/api/integrations/v1` (la pantalla de Gestión la muestra ya completa).

## 2. Llamadas

Fechas `AAAA-MM-DD` y horas `HH:MM`, siempre en la hora del local.

| Para qué | Llamada |
|---|---|
| Pautas del día para el prompt | `GET /guidelines?date=2026-11-20` (sin `date`: hoy) |
| Huecos libres | `GET /availability?date=2026-11-20&party=4` |
| Buscar reservas de un cliente | `GET /reservations?phone=600111222` o `?code=EYPTVS` |
| Reservar | `POST /reservations` |
| Cambiar día, hora, personas, notas | `PATCH /reservations/{código}` |
| Cancelar | `DELETE /reservations/{código}` |

### Pautas (`GET /guidelines`)

```json
{
  "venue": { "name": "Bar Demo", "timezone": "Europe/Madrid", "today": "2026-11-19", "now": "12:10" },
  "date": "2026-11-19",
  "reservationsOpen": false,
  "text": "Restaurante: Bar Demo. Fecha: 2026-11-19.\nEse día NO se aceptan reservas.\n- Hoy: Hoy no hacemos reservas, es por orden de llegada (sin reservas este día)\n- Siempre: Tenemos opciones sin gluten.",
  "notes": [ … ],
  "hours": "13:00-16:00, 20:00-23:00",
  "settings": { "slotMinutes": 30, "durationMinutes": 90, "maxPartySize": 10, "minNoticeMinutes": 60 }
}
```

Mete `text` tal cual en el *system prompt* del agente, por ejemplo:

```
Eres el agente de reservas del restaurante. Pautas de hoy (obligatorias):
{{ $('Pautas').item.json.text }}
Usa las herramientas para consultar huecos antes de confirmar nada. Pide nombre, teléfono, día, hora y número de personas.
```

### Huecos (`GET /availability`)

```json
{ "date": "2026-11-20", "partySize": 4, "open": true, "reason": null,
  "slots": [ { "time": "13:00", "available": true, "remainingCovers": 36 }, … ] }
```

Si `open` es `false`, `reason` explica por qué (pauta del día, día cerrado, grupo demasiado grande…).

### Reservar (`POST /reservations`)

```json
{ "name": "Lucía Gómez", "phone": "600111222", "partySize": 4, "date": "2026-11-20", "time": "13:00", "notes": "Cumpleaños" }
```

Responde `201` con la reserva, incluido su **código** (`"code": "EYPTVS"`), que el agente debe dar al cliente para cambiarla o cancelarla.

Errores útiles para el agente (código `409`, con `details.reason` en lenguaje natural y, si aplica, `details.slots` con las horas libres):

- `slot_full`: esa hora está llena → ofrece `details.slots`.
- `slot_not_offered`: esa hora no está en el horario.
- `reservations_closed`: ese día no se reserva (p. ej. pauta «por orden de llegada»).

### Cambiar y cancelar

`PATCH /reservations/EYPTVS` con los campos a cambiar (`date`, `time`, `partySize`, `name`, `phone`, `notes`). Se vuelve a comprobar el hueco.  
`DELETE /reservations/EYPTVS` la marca como cancelada (sigue en el historial).

## 3. Montarlo en n8n

1. Nodo de entrada (WhatsApp, Telegram, webhook…).
2. **HTTP Request** «Pautas» → `GET /guidelines` con la credencial. Su `text` va al prompt del agente.
3. **AI Agent** con estas herramientas (**HTTP Request Tool**, misma credencial):
   - `consultar_huecos`: `GET /availability`, parámetros `date` y `party` que rellena el modelo.
   - `buscar_reservas`: `GET /reservations`, parámetro `phone`.
   - `reservar`: `POST /reservations`, cuerpo JSON con `name, phone, partySize, date, time, notes`.
   - `modificar_reserva`: `PATCH /reservations/{code}`.
   - `cancelar_reserva`: `DELETE /reservations/{code}`.
4. Respuesta al cliente.

Todo lo que haga el agente aparece al momento en **Reservas** (etiqueta «Agente») y queda en el registro de auditoría. El personal puede apuntar reservas a mano aunque el sistema diga que está lleno; el agente no.

## 4. Ajustes que afectan al agente

En **Gestión → Reservas**:

- **Pautas**: permanentes («tenemos opciones sin gluten») o de un día («hoy no hacemos reservas, es por orden de llegada»). Las de un día pueden marcar «ese día no se aceptan reservas» y entonces `availability` sale cerrada.
- **Horario y capacidad**: horario por día de la semana (`13:00-16:00, 20:00-23:00`), comensales con reserva a la vez, máximo por reserva, duración, cada cuánto hay turno y antelación mínima.

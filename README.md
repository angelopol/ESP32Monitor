# Monitor de Luz (ESP32 + PWA en Vercel)

Un ESP32 enchufado a la pared hace un **ping cada 5 s** a un servidor Next.js en
Vercel. Si el servidor no recibe pings durante más que el umbral (15 s por
defecto), asume que **se cortó la electricidad** y manda una **notificación push**
a los usuarios que tengan la PWA instalada. Además expone un endpoint para que
otros dispositivos IoT sepan si hay o no hay luz.

```
  ESP32  ──POST /api/ping (cada 5s)──►  Vercel (Next.js)  ──►  Upstash Redis
                                              │
                                              ├─ cron cada 60s ─► /api/check ─► Web Push
                                              │
  IoT / scripts  ──GET /api/status?format=plain──►  "ON" | "OFF"
```

## Por qué está diseñado así

Vercel es serverless: no hay un proceso vivo que vigile "¿pasaron 10 s sin
ping?". Entonces:

- **`lastPing`** se guarda en Redis en cada ping (1 sola escritura, barato).
- El estado **se deriva en vivo**: `hay luz ⇔ (now − lastPing) ≤ umbral`. Por eso
  `/api/status` siempre responde bien aunque nadie haya "chequeado".
- Las **notificaciones** las dispara `/api/check`, que compara el estado vivo con
  el último estado guardado y notifica sólo en la transición. Lo llama:
  - el **cron de Vercel cada 60 s** (mínimo que permite Vercel), y
  - opcionalmente cualquier dispositivo tuyo con el token, para detección más
    rápida (ver abajo).
- El **primer ping tras reconectar** lleva `&boot=1`, así el aviso de
  *"volvió la luz"* es inmediato sin depender del cron.

### Latencia del aviso de corte

| Quién le pega a `/api/check` | Latencia de "se fue la luz" |
|---|---|
| Sólo el cron de Vercel | hasta ~60 s |
| + un poller externo cada 15 s (cron-job.org, otro ESP32, una Raspberry, el router) | ~15–20 s |

El aviso de *"volvió la luz"* siempre es casi inmediato (`boot=1`).

## Puesta en marcha

### 1. Redis (Upstash)

1. Creá una base gratis en <https://console.upstash.com> → **Create Database**.
2. En la pestaña **REST API** copiá `UPSTASH_REDIS_REST_URL` y
   `UPSTASH_REDIS_REST_TOKEN`.

### 2. Claves de Web Push (VAPID)

```bash
npm install
npm run vapid        # imprime VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY
```

### 3. Variables de entorno

Copiá `.env.example` a `.env.local` (para `npm run dev`) y cargá **las mismas**
en Vercel → *Project Settings → Environment Variables*:

| Variable | Qué es |
|---|---|
| `DEVICE_TOKEN` | secreto que el ESP32 manda en cada ping |
| `CRON_SECRET` | secreto del cron de Vercel (`openssl rand -hex 32`) |
| `OFFLINE_THRESHOLD_SECONDS` | segundos sin ping para declarar corte (def. `15`) |
| `DISPLAY_TZ` | zona horaria para las notificaciones |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Redis |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |

> `CRON_SECRET`: al estar seteada, Vercel manda `Authorization: Bearer <CRON_SECRET>`
> automáticamente en cada ejecución del cron definido en `vercel.json`.

### 4. Deploy

```bash
npm i -g vercel   # si no lo tenés
vercel            # primer deploy
vercel --prod
```

El cron de `vercel.json` (`/api/check` cada minuto) se activa solo al deployar.

### 5. Flashear el ESP32

Abrí `ESP32Monitor/ESP32Monitor.ino` en el Arduino IDE (con el core de ESP32
instalado), completá arriba:

```cpp
const char *WIFI_SSID   = "...";
const char *WIFI_PASS   = "...";
const char *SERVER_URL  = "https://tu-app.vercel.app";   // sin barra final
const char *DEVICE_TOKEN = "...";                        // == env de Vercel
```

Subilo. En el monitor serie (115200) deberías ver `[ping] 200`.

### 6. Instalar la PWA

Abrí la URL de Vercel en el celular → *Agregar a pantalla de inicio* →
abrí la app → **Activar notificaciones**.

- Android/Chrome: funciona directo.
- iOS: requiere **16.4+** y la app **instalada** (no sirve en Safari suelto).

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET`/`POST` | `/api/ping?token=…&rssi=…&boot=1` | `DEVICE_TOKEN` | lo llama el ESP32 |
| `GET` | `/api/status` | pública (CORS `*`) | JSON del estado |
| `GET` | `/api/status?format=plain` | pública | `ON` / `OFF` en texto plano |
| `GET` | `/api/status?history=1` | pública | agrega historial de eventos |
| `GET`/`POST` | `/api/check` | `CRON_SECRET` **o** `DEVICE_TOKEN` | evalúa y notifica |
| `POST` | `/api/subscribe` | — | guarda una PushSubscription |
| `POST` | `/api/unsubscribe` | — | `{ "endpoint": "…" }` |
| `GET` | `/api/vapid` | pública | `{ "publicKey": "…" }` |

### Respuesta de `/api/status`

```json
{
  "power": true,
  "state": "on",
  "lastPingAt": "2026-09-03T12:34:56.000Z",
  "secondsSincePing": 3,
  "since": "2026-09-03T10:00:00.000Z",
  "thresholdSeconds": 15,
  "rssi": -61,
  "serverTime": "2026-09-03T12:34:59.000Z"
}
```

## Usar el estado desde otros dispositivos IoT

```bash
# texto plano, ideal para un ESP32/relé
curl https://tu-app.vercel.app/api/status?format=plain     # -> ON  |  OFF

# JSON
curl https://tu-app.vercel.app/api/status | jq .power
```

Ejemplo en un segundo ESP32 (apagar algo si no hay luz de red y estás en UPS):

```cpp
int code = http.GET();                 // GET /api/status?format=plain
String body = http.getString();        // "ON" / "OFF"
digitalWrite(RELAY_PIN, body == "ON" ? HIGH : LOW);
```

## Detección más rápida que 60 s (opcional)

Poné algo siempre encendido a pegarle a `/api/check` con el token:

```bash
# cron-job.org / cualquier scheduler, cada 15-30s
curl "https://tu-app.vercel.app/api/check?token=DEVICE_TOKEN"
```

o desde un dispositivo en tu red (Raspberry, NAS, otro ESP32) en un loop cada 15 s.

## Costos / límites

- **Ping cada 5 s** ≈ 1 escritura Redis → ~520k comandos/mes. Entra casi justo en
  el free tier de Upstash (500k/mes). Si agregás pollers o bajás el intervalo,
  pasá a *pay-as-you-go* (centavos) o subí `PING_INTERVAL_MS` a 6000.
- Vercel Hobby: el cron corre 1×/min y las funciones son de sobra para esto.

## Desarrollo local

```bash
npm install
npm run dev      # http://localhost:3000
```

Sin `UPSTASH_*` usa un store en memoria (sólo dev). Para probar push necesitás
`VAPID_*` y HTTPS o `localhost`.

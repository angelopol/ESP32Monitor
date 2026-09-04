# Monitor de Luz (ESP32 + PWA multiusuario en Vercel)

Cada **dispositivo** ESP32 representa una **ubicación** ("Casa", "Oficina", "Bomba
de agua") y hace un ping cada 5 s a un servidor Next.js en Vercel. Si el servidor
no recibe pings durante más que el umbral del dispositivo (15 s por defecto),
asume que **se cortó la electricidad** y manda una **notificación push**:

> ⚡ **No hay luz en Casa** — El monitor dejó de responder. Último ping 21:30:05.

Los usuarios se registran con correo + contraseña, ven el estado de sus
dispositivos y **pueden compartir un dispositivo con otros usuarios por correo**
para que también lo vean y reciban las notificaciones. Además hay un endpoint por
dispositivo para que otros aparatos IoT actúen según haya o no luz.

```
  ESP32 "Casa"    ──/api/ping?token=<tokenCasa>──►  Vercel (Next.js) ──► Upstash Redis
  ESP32 "Oficina" ──/api/ping?token=<tokenOfi>───►        │
                                        cada request dispara, en 2º plano y
                                        con lock (~1 / 10 s), un barrido de
                                        todos los dispositivos ──► Web Push a los
                                        miembros del que cambió de estado
  Otro IoT  ──/api/status?token=<tokenCasa>&format=plain──►  "ON" | "OFF"
```

## Modelo de datos (Upstash Redis)

| Clave | Contenido |
|---|---|
| `user:<id>` | `{ id, email, passwordHash, createdAt }` |
| `user:byEmail:<email>` | `<userId>` |
| `session:<token>` | `{ uid, remember }` — cookie `sid` httpOnly. "Recordar sesión" ON → ~13 meses con renovación automática en cada `/api/auth/me`; OFF → cookie de sesión + TTL 2 días |
| `invite:<email>` | `[deviceId, …]` pendientes hasta que ese correo se registre |
| `device:<id>` | `{ id, name, ownerId, token, thresholdSeconds, createdAt }` |
| `device:byToken:<token>` | `<deviceId>` (auth del ping / status IoT) |
| `device:<id>:members` | SET de `userId` con acceso (incluye al dueño) |
| `user:<uid>:devices` | SET de `deviceId` accesibles (para listar rápido) |
| `devices:all` | SET de todos los `deviceId` (lo recorre el cron) |
| `device:<id>:lastPing` | `{ at, ip?, rssi?, vbat? }` — **1 escritura por ping** |
| `device:<id>:state` / `:since` / `:history` | estado persistido y transiciones |
| `user:<uid>:subs` | `[PushSubscription, …]` de ese usuario |

## Por qué está diseñado así

Vercel es serverless: no hay un proceso vivo vigilando "¿pasaron 10 s?". Y en el
plan **Hobby los cron jobs corren solo 1 vez al día**, así que no se puede
depender del cron para detectar cortes.

- El ping solo hace **1 escritura** (`device:<id>:lastPing`).
- El estado **se deriva en vivo**: `hay luz ⇔ (now − lastPing) ≤ umbral`.
- **La detección no usa cron.** Cualquier request que llega al servidor —el ping
  del ESP32 (cada 5 s), un poll de `/api/status` de otro IoT, o la app abierta
  refrescando— dispara en segundo plano (`after()`) un **barrido de todos los
  dispositivos**, con un lock en Redis que lo limita a **~1 cada 10 s**. Un
  pre-filtro barato (1 `mget`) hace que el barrido solo evalúe a fondo los
  dispositivos que realmente cambiaron de estado.
  - Con varios dispositivos, los que están vivos "vigilan" a los caídos.
  - Con un solo dispositivo: si se corta la luz ahí y **nadie** tiene la app
    abierta ni hay un monitor externo, el aviso espera hasta que el dispositivo
    vuelva (ahí es instantáneo) o alguien abra la app. Para cubrir ese caso, ver
    *"Detección garantizada"* más abajo.
- El **primer ping tras reconectar** lleva `&boot=1` → aviso de "volvió la luz"
  inmediato, sin esperar al barrido.
- El **cron diario de Vercel** (`/api/check`, permitido en Hobby) es solo un
  barrido de respaldo 1 vez al día.
- Lock corto en Redis por (dispositivo, estado destino) para no duplicar avisos.

### Latencia del aviso de corte

| Situación | Latencia de "no hay luz" |
|---|---|
| Otro dispositivo pinguea, o la app está abierta, o hay un IoT consultando | ~10–15 s |
| Un solo dispositivo, se corta ahí, nadie mirando, sin monitor externo | hasta que vuelva la luz / se abra la app / el cron diario |
| + monitor externo cada 1 min a `/api/check` (ver abajo) | ~60 s garantizado |

### Detección garantizada (opcional pero recomendado con 1 solo dispositivo)

Poné un servicio gratuito de cron externo apuntando a `/api/check`:

- **cron-job.org** (gratis, hasta 1×/min): URL
  `https://tu-app.vercel.app/api/check`, header
  `Authorization: Bearer <CRON_SECRET>` → evalúa **todos** los dispositivos.
- o cualquier aparato siempre encendido (otro ESP32, Raspberry, NAS, el router)
  haciendo `GET /api/check?token=<tokenDelDispositivo>` en loop.

## Puesta en marcha

### 1. Redis (Upstash)

Creá una base gratis en <https://console.upstash.com> → **Create Database** →
pestaña **REST API** → copiá `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.

### 2. Claves de Web Push (VAPID)

```bash
npm install
npm run vapid        # imprime VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY
```

### 3. Variables de entorno

Copiá `.env.example` a `.env.local` y cargá las mismas en Vercel:

| Variable | Qué es |
|---|---|
| `CRON_SECRET` | secreto del cron (`openssl rand -hex 32`) |
| `OFFLINE_THRESHOLD_SECONDS` | umbral por defecto (cada dispositivo puede tener el suyo) |
| `SIGNUP_CODE` | *opcional*: si lo seteás, hay que ingresarlo para registrarse |
| `DISPLAY_TZ` | zona horaria de las notificaciones (`America/Caracas`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Redis |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |

> Ya no existe un `DEVICE_TOKEN` global: cada dispositivo genera su token al
> crearse en la app.

### 4. Deploy

```bash
vercel && vercel --prod
```

`vercel.json` define un cron **diario** (`/api/check` a las 12:00 UTC) como
respaldo — es lo máximo que permite el plan Hobby. La detección real de cortes no
depende de él (ver *"Por qué está diseñado así"*).

### 5. Crear un dispositivo y flashear el ESP32

1. Abrí la URL de Vercel → **Crear cuenta**.
2. **+ Agregar dispositivo** → poné el nombre de la ubicación (ej. "Casa").
3. En la tarjeta → **Conexión ESP32**: copiá `SERVER_URL` y `DEVICE_TOKEN`.
4. Copiá `ESP32Monitor/secrets.example.h` a `ESP32Monitor/secrets.h` y completá
   WiFi, `SERVER_URL`, `DEVICE_TOKEN` y una `OTA_PASSWORD` propia. `secrets.h`
   está en `.gitignore` (no se sube a GitHub).
5. Abrí `ESP32Monitor/ESP32Monitor.ino` en el Arduino IDE (core de ESP32) y subilo
   por USB. En el monitor serie (115200) verás `[ping] 200` y `[ota] listo`.

**Actualizar el firmware ya instalado (sin cable):** con la PC en la misma red,
en el Arduino IDE aparece un puerto de red `esp32monitor at x.x.x.x` — elegilo,
subí, y te pide la `OTA_PASSWORD`. El firmware además **se reinicia solo** si pasa
10 min sin un ping exitoso o si se queda sin RAM.

### 6. Compartir con otra persona

En la tarjeta del dispositivo → **Compartir** → escribí el correo.

- Si ya tiene cuenta: la ve al instante.
- Si no: queda **invitada** y hereda el dispositivo cuando cree la cuenta con ese
  mismo correo. (No se envía email — avisale vos por fuera.)

### 7. Instalar la PWA y activar avisos

Abrir la URL en el celular → *Agregar a pantalla de inicio* → abrir la app →
**Activar notificaciones** (iOS: 16.4+ y la app instalada).

## Endpoints

### Auth (cookie de sesión)
| Método | Ruta | Cuerpo |
|---|---|---|
| `POST` | `/api/auth/register` | `{ email, password, code? }` |
| `POST` | `/api/auth/login` | `{ email, password }` |
| `POST` | `/api/auth/logout` | — |
| `GET` | `/api/auth/me` | — |

### Dispositivos (requieren sesión)
| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/api/devices` | mis dispositivos + estado en vivo |
| `POST` | `/api/devices` | `{ name, thresholdSeconds? }` → devuelve `token` |
| `GET` | `/api/devices/:id` | detalle + estado |
| `PATCH` | `/api/devices/:id` | `{ name?, thresholdSeconds? }` (sólo dueño) |
| `DELETE` | `/api/devices/:id` | sólo dueño |
| `GET` | `/api/devices/:id/members` | sólo dueño |
| `POST` | `/api/devices/:id/members` | `{ email }` → agrega o invita (sólo dueño) |
| `DELETE` | `/api/devices/:id/members` | `{ userId }` (sólo dueño) |

### Dispositivo / IoT (auth por token de dispositivo)
| Método | Ruta | Descripción |
|---|---|---|
| `GET`/`POST` | `/api/ping?token=…&rssi=…&boot=1` | lo llama el ESP32 |
| `GET` | `/api/status?token=…` | JSON del estado de ese dispositivo (CORS `*`) |
| `GET` | `/api/status?token=…&format=plain` | `ON` / `OFF` |
| `GET` | `/api/status?token=…&history=1` | agrega historial |
| `GET`/`POST` | `/api/check?token=…` | evalúa y notifica **ese** dispositivo |
| `GET` | `/api/check` + `Authorization: Bearer <CRON_SECRET>` | **todos** (cron) |

### Push (requieren sesión)
| `POST` | `/api/push/subscribe` | guarda la PushSubscription del usuario |
| `POST` | `/api/push/unsubscribe` | `{ endpoint }` |
| `GET` | `/api/vapid` | `{ publicKey }` |

### Estadísticas (requiere sesión)
| `GET` | `/api/stats?range=day\|week\|month\|quarter\|year` | métricas de cortes |

## Estadísticas

Pestaña **Estadísticas** del dashboard. Todo se calcula sobre el log de eventos
(`device:<id>:history`, hasta 1000 eventos / ~18 meses) — no hay agregados
precalculados. Un corte es un intervalo `off → on` (o `off → ahora` si sigue sin
luz). Por rango elegido (día/semana/mes/90 días/año):

- **Tiempo total sin luz** y **cantidad de cortes**, con comparación contra el
  período anterior equivalente (▲/▼).
- **Disponibilidad** (`1 − tiempoSinLuz / ventana`), **peor corte**, **tiempo
  medio de recuperación**.
- **Ranking** entre lugares: dónde se corta más / menos, dónde hay más cortes,
  mejor disponibilidad.
- **Minutos sin luz por día** (barras).
- **Probabilidad de corte por día de la semana** — sobre los últimos 90 días:
  `días de ese weekday con al menos un corte / días observados`. Responde
  "¿qué tan probable es que se corte un lunes?".
- **Cortes por hora del día** — a qué hora suele irse la luz.

Las horas y los días se calculan en `DISPLAY_TZ` (Venezuela = UTC−4 fijo, sin
ajustes de horario de verano).

## Usar el estado desde otro dispositivo IoT

```bash
curl "https://tu-app.vercel.app/api/status?token=<TOKEN_DEL_DISPOSITIVO>&format=plain"
# -> ON  |  OFF
```

```cpp
// segundo ESP32: cortar una carga si no hay luz de red
int code = http.GET();                 // /api/status?token=...&format=plain
String body = http.getString();        // "ON" / "OFF"
digitalWrite(RELAY_PIN, body == "ON" ? HIGH : LOW);
```

## Costos / límites

- **Ping cada 5 s por dispositivo** ≈ 1 escritura Redis → ~520k comandos/mes por
  dispositivo. Con 1–2 dispositivos entra en el free tier de Upstash; con más,
  pasá a *pay-as-you-go* (centavos) o subí `PING_INTERVAL_MS`.
- `/api/devices` usa 3 llamadas a Redis sin importar cuántos dispositivos tengas.
- Vercel Hobby: el cron corre 1×/min; las funciones alcanzan de sobra.

## Desarrollo local

```bash
npm install
npm run dev      # http://localhost:3000
```

Sin `UPSTASH_*` usa un store en memoria (sólo dev, no persiste). Para push real
necesitás `VAPID_*` y `localhost` o HTTPS.

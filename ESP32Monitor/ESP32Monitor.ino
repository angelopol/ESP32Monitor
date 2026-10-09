/* =============================================================================
 *  ESP32 / ESP8266 Power Monitor  -  firmware
 *
 *  Hace un ping HTTPS al servidor cada cierto intervalo. Si el servidor deja de
 *  recibir pings (porque se corto la luz y el equipo se apago) la PWA avisa.
 *
 *  Placas soportadas: ESP32 (clasico y C3) y ESP8266 (NodeMCU, Wemos D1, etc).
 *  El MISMO .ino compila para las dos familias: lo decide la placa que elijas
 *  en Tools > Board. Las diferencias de API entre plataformas estan aisladas
 *  en las funciones resetReasonText(), applyWifiSleep(), hardenTlsClient() y
 *  scanIsOpen().
 *
 *  - En el primer ping despues de (re)conectar al WiFi manda &boot=1, para que
 *    el servidor dispare "volvio la luz" al instante.
 *  - Manda &rssi=<dBm> para mostrar la señal en el dashboard.
 *  - OTA: podes subir firmware nuevo por WiFi (Arduino IDE -> puerto de red
 *    "<hostname> at x.x.x.x"), sin cable, util una vez instalado.
 *  - Al arrancar imprime el MOTIVO del ultimo reinicio: si el equipo se reinicia
 *    solo, el serial te dice por que en vez de tener que adivinar.
 *
 *  Portal de configuracion:
 *  - La configuracion (WiFi, servidor, token, hostname, OTA, intervalo) se
 *    guarda en flash. secrets.h solo aporta los valores POR DEFECTO, que se usan
 *    mientras no se haya guardado nada desde el portal (o tras "Restablecer").
 *  - Si no hay WiFi configurado, o no logra conectarse (o conecta pero el
 *    servidor no responde por varios minutos), levanta un punto de acceso
 *    ABIERTO "ESP32Monitor-XXXX". Al conectarte, el telefono abre solo la
 *    pagina de configuracion (portal cautivo); si no, entra a http://192.168.4.1
 *  - Con WiFi funcionando, la misma pagina esta en http://<hostname>.local
 *    (por defecto http://esp32monitor.local) o en la IP del equipo.
 *  - El acceso a la pagina es libre (sin clave). Las contraseñas y el token
 *    nunca se muestran: dejar el campo vacio = mantener el valor actual.
 *
 *  Nota ESP8266: el stack de loop() ("cont stack") es de 4 KB y NO se puede
 *  agrandar de forma confiable desde el .ino (el IDE inserta Arduino.h antes
 *  que cualquier codigo del sketch, asi que un #define CONT_STACKSIZE aca no
 *  llega a tiempo -- si lo intentas vas a ver un warning de "redefined" que
 *  confirma que no sirvio de nada). La mitigacion real para TLS en ESP8266 es
 *  reducir el consumo de RAM de BearSSL, ver hardenTlsClient().
 *
 *  Libs (todas vienen con el core, no hay que instalar nada):
 *          ArduinoOTA, DNSServer, EEPROM (comunes a ambas plataformas) +
 *          ESP32:   WiFi.h, WiFiClientSecure.h, HTTPClient.h, WebServer.h, ESPmDNS.h
 *          ESP8266: ESP8266WiFi.h, WiFiClientSecure.h (alias de BearSSL),
 *                   ESP8266HTTPClient.h, ESP8266WebServer.h, ESP8266mDNS.h
 * ---------------------------------------------------------------------------- */

#if defined(ESP32)
  #include <WiFi.h>
  #include <WiFiClientSecure.h>
  #include <HTTPClient.h>
  #include <WebServer.h>
  #include <ESPmDNS.h>
  #include <esp_system.h>
  typedef WebServer ConfigWebServer;
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <WiFiClientSecure.h>     // en ESP8266 es un alias de BearSSL::WiFiClientSecure
  #include <ESP8266HTTPClient.h>
  #include <ESP8266WebServer.h>
  #include <ESP8266mDNS.h>
  typedef ESP8266WebServer ConfigWebServer;
#else
  #error "Placa no soportada. En Tools > Board elegi un ESP32 (o C3) o un ESP8266."
#endif

#include <ArduinoOTA.h>   // misma API en las dos plataformas
#include <DNSServer.h>
#include <EEPROM.h>

// Valores por defecto (WIFI_SSID / WIFI_PASS / SERVER_URL / DEVICE_TOKEN /
// OTA_*) en secrets.h (ignorado por git). Es opcional: sin el, el equipo
// arranca sin configurar y levanta el punto de acceso para configurarlo.
#if __has_include("secrets.h")
  #include "secrets.h"
#endif
#ifndef WIFI_SSID
  #define WIFI_SSID ""
#endif
#ifndef WIFI_PASS
  #define WIFI_PASS ""
#endif
#ifndef SERVER_URL
  #define SERVER_URL ""
#endif
#ifndef DEVICE_TOKEN
  #define DEVICE_TOKEN ""
#endif
#ifndef OTA_HOSTNAME
  #define OTA_HOSTNAME "esp32monitor"
#endif
#ifndef OTA_PASSWORD
  #define OTA_PASSWORD ""
#endif
// Clave del punto de acceso de configuracion. Vacia = red abierta.
// Si la definis en secrets.h tiene que tener 8 caracteres o mas.
#ifndef AP_PASSWORD
  #define AP_PASSWORD ""
#endif

#if defined(ESP32)
// El handshake TLS corre dentro de loop(); el stack por defecto (8 KB) queda
// justo y puede desbordar (crash -> reinicio). Con 16 KB va holgado. Esto SI
// funciona de forma confiable en ESP32: es una variable global (no un macro)
// que el arranque del core lee en tiempo de ejecucion, no depende del orden
// de #includes como el CONT_STACKSIZE de ESP8266 (ver nota mas arriba).
SET_LOOP_TASK_STACK_SIZE(16 * 1024);
#endif

// ----------------------------- CONFIGURACION ---------------------------------
// Subi este numero en cada cambio: al arrancar lo imprime, asi confirmas que la
// actualizacion (OTA o USB) entro.
#define FW_VERSION 4

// LED de estado. APAGADO por defecto: en ESP32-C3 el GPIO2 es strapping pin de
// arranque y moverlo puede impedir el boot; en ESP8266 el LED_BUILTIN suele
// ser activo en LOW (al reves que en ESP32). Si tu placa tiene un LED simple
// en un pin seguro, pone esto en 1 y ajusta STATUS_LED_PIN.
#define USE_STATUS_LED 0
#define STATUS_LED_PIN 2

// Ahorro de energia del WiFi (valor por defecto, se cambia desde el portal).
// true = menor consumo (recomendado: si el equipo se reinicia solo, casi
// siempre es la fuente que no aguanta los picos).
// false = reconexion un pelo mas rapida pero varias veces mas consumo continuo.
#define WIFI_LOW_POWER true

const unsigned long PING_INTERVAL_MS = 5000;      // por defecto, editable en el portal
const unsigned long HTTP_TIMEOUT_MS  = 4000;      // timeout por request
const unsigned long WIFI_CONNECT_MS  = 15000;     // cuanto esperar cada intento
const unsigned long WIFI_RETRY_MS    = 10000;     // reintento de WiFi
const unsigned long WIFI_RETRY_AP_MS = 30000;     // reintento con el AP prendido
const unsigned long STATUS_LOG_MS    = 60000;     // resumen por serial

// --- Punto de acceso / portal ---
const unsigned long AP_AFTER_MS       = 30000;         // sin WiFi -> prender AP
const unsigned long AP_NO_INTERNET_MS = 3UL * 60 * 1000; // WiFi ok pero sin ping OK -> AP
const unsigned long PORTAL_IDLE_MS    = 3UL * 60 * 1000; // uso reciente del portal

// --- Watchdogs (conservadores: reiniciar es el ultimo recurso) ---
const unsigned long REBOOT_AFTER_MS  = 15UL * 60 * 1000;  // sin ping OK -> reboot
const unsigned long WD_GRACE_MS      = 5UL  * 60 * 1000;  // no reiniciar antes de esto
const uint32_t      MIN_FREE_HEAP    = 8000;      // bytes
const uint8_t       HEAP_STRIKES     = 20;        // lecturas bajas seguidas para actuar
// ---------------------------------------------------------------------------

// Configuracion persistida en flash. Si cambias la estructura, cambia
// CONFIG_MAGIC: asi una config vieja no se lee como basura.
const uint32_t CONFIG_MAGIC = 0xC0F1A001;
struct Config {
  uint32_t magic;
  char     ssid[33];
  char     pass[65];
  char     serverUrl[128];
  char     token[80];
  char     hostname[33];
  char     otaPass[65];
  uint32_t pingIntervalMs;
  uint8_t  lowPower;
};

Config cfg;
bool cfgFromFlash = false;

WiFiClientSecure client;
ConfigWebServer  server(80);
DNSServer        dns;
String           apSsid;

unsigned long lastPingAttempt   = 0;
unsigned long lastWifiTry       = 0;
unsigned long lastOkMs          = 0;   // ultimo ping con respuesta HTTP del server
unsigned long lastStatusLog     = 0;
unsigned long disconnectedSince = 0;
unsigned long lastPortalUse     = 0;   // 0 = nadie uso la pagina todavia
unsigned long restartAt         = 0;   // 0 = sin reinicio programado
unsigned long pingOk = 0, pingFail = 0;
uint32_t minHeapSeen  = UINT32_MAX;
uint8_t  heapStrikes  = 0;
bool bootPing     = true;            // el proximo ping lleva &boot=1
bool wasConnected = false;
bool wifiTrying   = false;
bool otaReady     = false;
bool apActive     = false;

void setLed(bool on) {
#if USE_STATUS_LED
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
#else
  (void)on;
#endif
}

// Motivo del ultimo reinicio, en texto. La API para obtenerlo es distinta en
// cada plataforma; ESP8266 ya lo devuelve como texto legible, a ESP32 hay que
// traducirle el enum.
String resetReasonText() {
#if defined(ESP32)
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "POWERON (se corto y volvio la alimentacion)";
    case ESP_RST_EXT:       return "EXT (reset externo / boton)";
    case ESP_RST_SW:        return "SW (ESP.restart() del propio firmware)";
    case ESP_RST_PANIC:     return "PANIC (crash del firmware)";
    case ESP_RST_INT_WDT:   return "INT_WDT (watchdog de interrupciones)";
    case ESP_RST_TASK_WDT:  return "TASK_WDT (watchdog de tarea)";
    case ESP_RST_WDT:       return "WDT (watchdog)";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "BROWNOUT (la fuente no aguanta: cargador/cable)";
    case ESP_RST_SDIO:      return "SDIO";
    default:                return "DESCONOCIDO";
  }
#elif defined(ESP8266)
  // Ya viene legible: "Power On", "External System", "Software/System restart",
  // "Exception", "Watchdog", "Hardware Watchdog", "Deep-Sleep Wake", etc.
  return ESP.getResetReason();
#endif
}

// Con el punto de acceso prendido el ahorro de energia se desactiva: con modem
// sleep los clientes del AP pierden paquetes (y en ESP32 ni se permite).
void applyWifiSleep(bool lowPower) {
#if defined(ESP32)
  WiFi.setSleep(lowPower);
#elif defined(ESP8266)
  WiFi.setSleepMode(lowPower ? WIFI_MODEM_SLEEP : WIFI_NONE_SLEEP);
#endif
}

void hardenTlsClient() {
  client.setInsecure();
#if defined(ESP8266)
  // BearSSL reserva bastante RAM por conexion; con ~80 KB de heap total en el
  // ESP8266 esto evita quedarse sin memoria durante el handshake.
  client.setBufferSizes(1024, 1024);
#endif
}

bool scanIsOpen(int i) {
#if defined(ESP32)
  return WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
#elif defined(ESP8266)
  return WiFi.encryptionType(i) == ENC_TYPE_NONE;
#endif
}

// ------------------------------ config en flash -----------------------------

void copyStr(char *dst, size_t size, const String &src) {
  strncpy(dst, src.c_str(), size - 1);
  dst[size - 1] = '\0';
}

void loadDefaults() {
  memset(&cfg, 0, sizeof(cfg));
  copyStr(cfg.ssid,      sizeof(cfg.ssid),      WIFI_SSID);
  copyStr(cfg.pass,      sizeof(cfg.pass),      WIFI_PASS);
  copyStr(cfg.serverUrl, sizeof(cfg.serverUrl), SERVER_URL);
  copyStr(cfg.token,     sizeof(cfg.token),     DEVICE_TOKEN);
  copyStr(cfg.hostname,  sizeof(cfg.hostname),  OTA_HOSTNAME);
  copyStr(cfg.otaPass,   sizeof(cfg.otaPass),   OTA_PASSWORD);
  cfg.pingIntervalMs = PING_INTERVAL_MS;
  cfg.lowPower       = WIFI_LOW_POWER;
}

void loadConfig() {
  EEPROM.begin(sizeof(Config));
  EEPROM.get(0, cfg);
  cfgFromFlash = cfg.magic == CONFIG_MAGIC;
  if (!cfgFromFlash) {
    loadDefaults();              // no se graba: secrets.h sigue mandando hasta
    return;                      // que se guarde algo desde el portal
  }
  // Blindaje ante flash corrupta: todas las cadenas terminadas en \0.
  cfg.ssid[sizeof(cfg.ssid) - 1] = '\0';
  cfg.pass[sizeof(cfg.pass) - 1] = '\0';
  cfg.serverUrl[sizeof(cfg.serverUrl) - 1] = '\0';
  cfg.token[sizeof(cfg.token) - 1] = '\0';
  cfg.hostname[sizeof(cfg.hostname) - 1] = '\0';
  cfg.otaPass[sizeof(cfg.otaPass) - 1] = '\0';
  if (!cfg.hostname[0]) copyStr(cfg.hostname, sizeof(cfg.hostname), OTA_HOSTNAME);
  if (cfg.pingIntervalMs < 2000 || cfg.pingIntervalMs > 3600000UL)
    cfg.pingIntervalMs = PING_INTERVAL_MS;
}

void saveConfig() {
  cfg.magic = CONFIG_MAGIC;
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

void eraseConfig() {
  cfg.magic = 0;
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

bool isConfigured() {
  return cfg.ssid[0] && cfg.serverUrl[0] && cfg.token[0];
}

// ---------------------------------- red -------------------------------------

void setupOTA() {
  ArduinoOTA.setHostname(cfg.hostname);
  if (cfg.otaPass[0]) ArduinoOTA.setPassword(cfg.otaPass);
  ArduinoOTA.onStart([]() { Serial.println("[ota] iniciando actualizacion"); });
  ArduinoOTA.onEnd([]() { Serial.println("\n[ota] fin"); });
  ArduinoOTA.onError([](ota_error_t e) { Serial.printf("[ota] error %u\n", e); });
  ArduinoOTA.begin();            // tambien levanta mDNS con el hostname
  MDNS.addService("http", "tcp", 80);
  otaReady = true;
  Serial.printf("[ota] listo (%s). Pagina de configuracion: http://%s.local\n",
                cfg.otaPass[0] ? "con clave" : "SIN clave", cfg.hostname);
}

void startWifiAttempt() {
  if (!cfg.ssid[0]) return;
  lastWifiTry = millis();
  wifiTrying  = true;
  Serial.printf("[wifi] conectando a %s ...\n", cfg.ssid);
  WiFi.disconnect();             // limpia estado previo (sin borrar config)
  WiFi.begin(cfg.ssid, cfg.pass);
}

void onWifiConnected() {
  Serial.printf("[wifi] OK  ssid=%s  ip=%s  rssi=%d\n", cfg.ssid,
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
  bootPing     = true;           // (re)conecto -> marcar boot
  wasConnected = true;
  wifiTrying   = false;
  if (!otaReady) setupOTA();
}

void startAP() {
  WiFi.mode(WIFI_AP_STA);
  applyWifiSleep(false);
  const char *pass = strlen(AP_PASSWORD) >= 8 ? AP_PASSWORD : nullptr;
  if (!WiFi.softAP(apSsid.c_str(), pass)) {
    Serial.println("[ap] no se pudo iniciar el punto de acceso");
    return;
  }
  // DNS "comodin": toda consulta responde con nuestra IP. Asi el telefono
  // detecta el portal cautivo y abre la pagina de configuracion solo.
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", WiFi.softAPIP());
  apActive = true;
  if (!otaReady) setupOTA();
  Serial.printf("[ap] punto de acceso \"%s\" activo -> http://%s\n",
                apSsid.c_str(), WiFi.softAPIP().toString().c_str());
}

void stopAP() {
  dns.stop();
  WiFi.softAPdisconnect(true);   // vuelve a modo solo estacion
  apActive = false;
  applyWifiSleep(cfg.lowPower);
  Serial.println("[ap] punto de acceso apagado");
}

// Alguien conectado al AP usando la pagina hace poco. Mientras tanto no se
// busca el WiFi (cambiar de canal buscando la red le corta la conexion al
// telefono) ni se apaga el AP ni se reinicia por watchdog.
bool portalInUse(unsigned long now) {
  return apActive && WiFi.softAPgetStationNum() > 0 && lastPortalUse &&
         now - lastPortalUse < PORTAL_IDLE_MS;
}

void handleWifi(unsigned long now) {
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wasConnected) onWifiConnected();
  if (!connected && wasConnected) {
    Serial.println("[wifi] conexion perdida");
    wasConnected      = false;
    disconnectedSince = now;
  }

  bool needAp = !isConfigured() ||
                (!connected && now - disconnectedSince >= AP_AFTER_MS) ||
                (connected && now - lastOkMs >= AP_NO_INTERNET_MS);
  if (needAp && !apActive) startAP();
  else if (!needAp && apActive && !portalInUse(now)) stopAP();

  if (connected || !cfg.ssid[0]) return;

  if (wifiTrying) {
    if (now - lastWifiTry < WIFI_CONNECT_MS) return;
    wifiTrying = false;
    WiFi.disconnect();           // corta los reintentos internos del driver
    Serial.println("[wifi] no conecto, reintenta luego");
  }
  if (portalInUse(now)) return;
  if (now - lastWifiTry >= (apActive ? WIFI_RETRY_AP_MS : WIFI_RETRY_MS))
    startWifiAttempt();
}

void sendPing() {
  if (WiFi.status() != WL_CONNECTED || !cfg.serverUrl[0] || !cfg.token[0]) return;

  String url = String(cfg.serverUrl) + "/api/ping?token=" + cfg.token +
               "&rssi=" + String(WiFi.RSSI());
  if (bootPing) url += "&boot=1";

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
#if defined(ESP32)
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
#endif

  if (!http.begin(client, url)) {
    Serial.println("[ping] http.begin fallo");
    pingFail++;
    return;
  }

  int code = http.GET();

  if (code > 0) {
    lastOkMs = millis();          // hubo ida y vuelta con el server
    pingOk++;
    setLed(true);
    if (code == 200) bootPing = false;
  } else {
    pingFail++;
    setLed(false);
    Serial.printf("[ping] fallo (codigo %d)\n", code);
  }

  http.end();
  client.stop();                  // cierra la conexion TLS, libera recursos
}

// ------------------------------ pagina web ----------------------------------

static const char PAGE_HEAD[] PROGMEM = R"HTML(<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Monitor</title><style>
:root{color-scheme:dark;--bg:#0f172a;--card:#1e293b;--tx:#e2e8f0;--mu:#94a3b8;--ac:#38bdf8;--bd:#334155;--er:#f87171}
*{box-sizing:border-box}body{margin:0;font:15px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--tx)}
main{max-width:520px;margin:0 auto;padding:16px}h1{font-size:20px;margin:4px 0 16px}
h2{font-size:15px;margin:0 0 8px;color:var(--ac)}a{color:var(--ac)}
section{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin:0 0 14px}
label{display:block;margin:12px 0 4px;color:var(--mu);font-size:13px}
input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--tx);font-size:15px}
label.ck{display:flex;align-items:center;gap:8px;color:var(--tx);font-size:15px}label.ck input{width:auto}
button{padding:10px 14px;border:0;border-radius:8px;background:var(--ac);color:#0f172a;font-weight:600;font-size:15px;cursor:pointer}
button.sec{background:var(--bd);color:var(--tx)}button.dan{background:transparent;color:var(--er);border:1px solid var(--er)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}small{display:block;color:var(--mu);margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:4px 0;vertical-align:top}td+td{text-align:right;color:var(--mu);word-break:break-all}
#nets div{padding:8px 4px;border-bottom:1px solid var(--bd);cursor:pointer;display:flex;justify-content:space-between;gap:8px}
</style></head><body><main><h1>ESP32 Power Monitor</h1>
)HTML";

static const char PAGE_SCRIPT[] PROGMEM = R"HTML(<script>
function scan(){var b=document.getElementById('sb'),l=document.getElementById('nets'),t=0;b.disabled=true;l.textContent='Buscando redes...';
function done(m){b.disabled=false;if(m)l.textContent=m}
function poll(){fetch('/scan').then(function(r){return r.json()}).then(function(d){
if(d.scanning){if(++t>15)return done('No se pudo escanear, reintenta.');return setTimeout(poll,1500)}
done();var seen={};var n=d.nets.sort(function(a,b){return b.rssi-a.rssi}).filter(function(x){if(!x.ssid||seen[x.ssid])return false;return seen[x.ssid]=1});
l.innerHTML='';if(!n.length)return done('No se encontraron redes.');
n.forEach(function(x){var e=document.createElement('div'),a=document.createElement('span'),s=document.createElement('small');
a.textContent=(x.open?'':'🔒 ')+x.ssid;s.textContent=x.rssi+' dBm';s.style.margin='0';e.appendChild(a);e.appendChild(s);
e.onclick=function(){document.getElementById('ssid').value=x.ssid;document.getElementById('pass').focus()};l.appendChild(e)})
}).catch(function(){done('Error al escanear.')})}poll()}
</script></main></body></html>)HTML";

String htmlEsc(const char *s) {
  String o;
  for (; *s; s++) {
    switch (*s) {
      case '&':  o += F("&amp;");  break;
      case '<':  o += F("&lt;");   break;
      case '>':  o += F("&gt;");   break;
      case '"':  o += F("&quot;"); break;
      case '\'': o += F("&#39;");  break;
      default:   o += *s;
    }
  }
  return o;
}

String fmtDuration(unsigned long secs) {
  unsigned long d = secs / 86400, h = (secs / 3600) % 24, m = (secs / 60) % 60;
  if (d) return String(d) + "d " + h + "h";
  if (h) return String(h) + "h " + m + "m";
  if (m) return String(m) + "m " + (secs % 60) + "s";
  return String(secs) + "s";
}

void addRow(String &p, const __FlashStringHelper *k, const String &v) {
  p += F("<tr><td>");
  p += k;
  p += F("</td><td>");
  p += v;
  p += F("</td></tr>");
}

void addInput(String &p, const char *id, const __FlashStringHelper *label,
              const char *type, int maxLen, const String &value,
              const String &placeholder) {
  p += F("<label for=");  p += id;  p += '>';  p += label;  p += F("</label>");
  p += F("<input id=");   p += id;  p += F(" name=");  p += id;
  p += F(" type=");       p += type;
  p += F(" maxlength=");  p += maxLen;
  // Los navegadores ignoran autocomplete=off en campos de clave y rellenan una
  // guardada (p.ej. la del WiFi) en "Clave OTA": al guardar cualquier otro
  // cambio se grababa esa clave sin que el usuario la viera. new-password lo evita.
  p += strcmp(type, "password") == 0 ? F(" autocomplete=new-password")
                                     : F(" autocomplete=off");
  p += F(" value=\"");    p += value;
  p += F("\" placeholder=\"");           p += placeholder;
  p += F("\">");
}

void touchPortal() {
  lastPortalUse = millis();
  if (!lastPortalUse) lastPortalUse = 1;
}

bool isOwnHost(const String &h) {
  return h == WiFi.softAPIP().toString() || h == WiFi.localIP().toString() ||
         h.equalsIgnoreCase(String(cfg.hostname) + ".local");
}

// En modo AP, cualquier pedido a otro dominio (las pruebas de conectividad de
// Android/iOS/Windows, o el sitio que sea) se redirige a la pagina: eso hace
// que el telefono muestre "Iniciar sesion en la red" y la abra solo.
bool captiveRedirect() {
  if (!apActive || isOwnHost(server.hostHeader())) return false;
  server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
  return true;
}

void sendPage(int code, const String &body) {
  String p;
  p.reserve(body.length() + 2600);
  p += FPSTR(PAGE_HEAD);
  p += body;
  p += FPSTR(PAGE_SCRIPT);
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "text/html; charset=utf-8", p);
}

void sendMessage(int code, const String &title, const String &msg) {
  sendPage(code, "<section><h2>" + title + "</h2><p>" + msg + "</p></section>");
}

void handleRoot() {
  if (captiveRedirect()) return;
  touchPortal();

  unsigned long now = millis();
  bool connected = WiFi.status() == WL_CONNECTED;
  String p;
  p.reserve(6000);

  p += F("<section><h2>Estado</h2><table>");
  addRow(p, F("Firmware"), "v" + String(FW_VERSION));
  addRow(p, F("WiFi"), connected ? htmlEsc(cfg.ssid) + " (" + WiFi.RSSI() + " dBm)"
                                 : String(F("desconectado")));
  if (connected) addRow(p, F("IP"), WiFi.localIP().toString());
  if (apActive)
    addRow(p, F("Punto de acceso"),
           htmlEsc(apSsid.c_str()) + " &middot; " + WiFi.softAPIP().toString());
  addRow(p, F("Ultimo ping OK"),
         pingOk ? "hace " + fmtDuration((now - lastOkMs) / 1000) : String(F("nunca")));
  addRow(p, F("Pings ok / fallos"), String(pingOk) + " / " + pingFail);
  addRow(p, F("Encendido hace"), fmtDuration(now / 1000));
  addRow(p, F("RAM libre"), String(ESP.getFreeHeap()) + " B");
  addRow(p, F("Configuracion"), cfgFromFlash ? String(F("guardada en el equipo"))
                                             : String(F("valores de secrets.h")));
  p += F("</table></section>");

  p += F("<form method=post action=/save><section><h2>WiFi</h2>");
  addInput(p, "ssid", F("Red (SSID)"), "text", 32, htmlEsc(cfg.ssid), "");
  p += F("<div class=row><button type=button class=sec id=sb onclick=scan()>"
         "Buscar redes</button></div><div id=nets></div>");
  addInput(p, "pass", F("Contrase&ntilde;a"), "password", 64, "",
           cfg.pass[0] ? F("(sin cambios)") : F("(red abierta)"));
  p += F("<small>Vac&iacute;o = mantener la actual. Si cambi&aacute;s de red y la "
         "dej&aacute;s vac&iacute;a, se toma como red abierta.</small></section>");

  p += F("<section><h2>Servidor</h2>");
  addInput(p, "url", F("URL del servidor (https://...)"), "url", 127,
           htmlEsc(cfg.serverUrl), "https://mi-monitor.vercel.app");
  String tokenHint = F("(sin configurar)");
  size_t tl = strlen(cfg.token);
  if (tl) tokenHint = "(sin cambios) ..." + htmlEsc(cfg.token + (tl > 4 ? tl - 4 : 0));
  addInput(p, "token", F("Token del dispositivo"), "password", 79, "", tokenHint);
  p += F("<small>Se copia desde la app web: tarjeta &rarr; Conexi&oacute;n ESP32.</small>");
  addInput(p, "interval", F("Intervalo de ping (segundos)"), "number", 4,
           String(cfg.pingIntervalMs / 1000), "5");
  p += F("<label class=ck><input type=checkbox name=lowpower value=1");
  if (cfg.lowPower) p += F(" checked");
  p += F(">Ahorro de energ&iacute;a del WiFi</label></section>");

  p += F("<section><h2>Equipo</h2>");
  addInput(p, "host", F("Nombre en la red (hostname)"), "text", 32,
           htmlEsc(cfg.hostname), "esp32monitor");
  p += F("<small>La p&aacute;gina queda en http://&lt;nombre&gt;.local</small>");
  addInput(p, "otapass", F("Clave OTA"), "password", 64, "",
           cfg.otaPass[0] ? F("(sin cambios)") : F("(sin clave)"));
  p += F("<div class=row><button>Guardar y reiniciar</button></div></section></form>");

  p += F("<section><h2>Acciones</h2><div class=row>"
         "<form method=post action=/restart><button class=sec>Reiniciar</button></form>"
         "<form method=post action=/reset onsubmit=\"return confirm('Se borra la "
         "configuracion guardada y se vuelve a la de secrets.h. Continuar?')\">"
         "<button class=dan>Restablecer</button></form></div></section>");

  sendPage(200, p);
}

void handleScan() {
  touchPortal();
  int n = WiFi.scanComplete();
  if (n == -2) {                 // no hay escaneo en curso ni resultados
    if (wifiTrying) {            // un intento de conexion bloquea el escaneo
      WiFi.disconnect();
      wifiTrying  = false;
      lastWifiTry = millis();
    }
    WiFi.scanNetworks(true);     // asincronico: no traba el loop
    n = -1;
  }
  if (n < 0) {
    server.send(200, "application/json", "{\"scanning\":true}");
    return;
  }
  String j = F("{\"nets\":[");
  for (int i = 0; i < n; i++) {
    if (i) j += ',';
    j += F("{\"ssid\":\"");
    String s = WiFi.SSID(i);
    for (unsigned int k = 0; k < s.length(); k++) {
      char c = s[k];
      if (c == '"' || c == '\\') { j += '\\'; j += c; }
      else if ((uint8_t)c >= 0x20) j += c;
    }
    j += F("\",\"rssi\":");  j += WiFi.RSSI(i);
    j += F(",\"open\":");    j += scanIsOpen(i) ? F("true") : F("false");
    j += '}';
  }
  j += F("]}");
  WiFi.scanDelete();
  server.send(200, "application/json", j);
}

void handleSave() {
  touchPortal();
  Config n = cfg;

  String ssid = server.arg("ssid");  ssid.trim();
  String pass = server.arg("pass");
  String url  = server.arg("url");   url.trim();
  String tok  = server.arg("token"); tok.trim();
  String host = server.arg("host");  host.trim();  host.toLowerCase();
  String otap = server.arg("otapass");
  long   secs = server.arg("interval").toInt();

  while (url.endsWith("/")) url.remove(url.length() - 1);

  String err;
  if (ssid.length() > 32)                         err = F("El SSID es demasiado largo.");
  else if (pass.length() && (pass.length() < 8 || pass.length() > 64))
                                                  err = F("La clave WiFi debe tener entre 8 y 64 caracteres.");
  else if (url.length() && !url.startsWith("https://"))
                                                  err = F("La URL del servidor debe empezar con https://");
  else if (url.length() >= sizeof(n.serverUrl))   err = F("La URL es demasiado larga.");
  else if (tok.length() >= sizeof(n.token))       err = F("El token es demasiado largo.");
  else if (host.length() >= sizeof(n.hostname))   err = F("El hostname es demasiado largo.");
  else if (secs < 2 || secs > 3600)               err = F("El intervalo debe estar entre 2 y 3600 segundos.");
  for (unsigned int i = 0; err.length() == 0 && i < host.length(); i++) {
    char c = host[i];
    if (!isalnum(c) && c != '-') err = F("El hostname solo admite letras, n&uacute;meros y guiones.");
  }
  if (err.length()) {
    sendMessage(400, F("No se guard&oacute;"), err + F("<br><br><a href=/>Volver</a>"));
    return;
  }

  // Clave WiFi vacia: si la red es la misma se mantiene; si es otra, se asume
  // que la red nueva es abierta.
  if (pass.length())                 copyStr(n.pass, sizeof(n.pass), pass);
  else if (ssid != String(cfg.ssid)) n.pass[0] = '\0';
  copyStr(n.ssid,      sizeof(n.ssid),      ssid);
  copyStr(n.serverUrl, sizeof(n.serverUrl), url);
  if (tok.length())  copyStr(n.token,   sizeof(n.token),   tok);
  if (otap.length()) copyStr(n.otaPass, sizeof(n.otaPass), otap);
  copyStr(n.hostname, sizeof(n.hostname), host.length() ? host : String(OTA_HOSTNAME));
  n.pingIntervalMs = (uint32_t)secs * 1000UL;
  n.lowPower       = server.hasArg("lowpower");

  cfg = n;
  saveConfig();
  cfgFromFlash = true;
  Serial.println("[portal] configuracion guardada, reiniciando");

  sendMessage(200, F("Guardado"),
              "El equipo se reinicia y se conecta a <b>" + htmlEsc(cfg.ssid) +
              "</b>. Despu&eacute;s pod&eacute;s volver a esta p&aacute;gina desde "
              "esa red en <a href=\"http://" + String(cfg.hostname) + ".local\">http://" +
              String(cfg.hostname) + ".local</a>. Si no logra conectarse, el punto "
              "de acceso <b>" + htmlEsc(apSsid.c_str()) + "</b> vuelve a aparecer.");
  restartAt = millis() + 1500;   // deja que la respuesta llegue al navegador
}

void handleRestart() {
  touchPortal();
  sendMessage(200, F("Reiniciando"), F("Volv&eacute; a cargar la p&aacute;gina en unos segundos."));
  restartAt = millis() + 1000;
}

void handleReset() {
  touchPortal();
  eraseConfig();
  sendMessage(200, F("Restablecido"),
              F("Se borr&oacute; la configuraci&oacute;n guardada. El equipo se "
                "reinicia con los valores de secrets.h."));
  restartAt = millis() + 1500;
}

void handleNotFound() {
  if (captiveRedirect()) return;
  server.send(404, "text/plain", "No encontrado");
}

void setupWebServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/scan", HTTP_GET, handleScan);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/restart", HTTP_POST, handleRestart);
  server.on("/reset", HTTP_POST, handleReset);
  server.onNotFound(handleNotFound);
  server.begin();
}

// -------------------------------- watchdogs ---------------------------------

void rebootWith(const char *motivo) {
  Serial.printf("[wd] %s -> reinicio\n", motivo);
  Serial.flush();
  delay(200);
  ESP.restart();
}

void guardWatchdogs() {
  uint32_t heap = ESP.getFreeHeap();
  if (heap < minHeapSeen) minHeapSeen = heap;

  // La RAM baja se cuenta por rachas: un bajon puntual durante un handshake TLS
  // es normal y NO debe reiniciar el equipo.
  if (heap < MIN_FREE_HEAP) heapStrikes++;
  else heapStrikes = 0;

  // Sin reinicios durante los primeros minutos: si el equipo arranca mal,
  // reiniciarlo en bucle solo empeora y no deja leer el serial.
  unsigned long now = millis();
  if (now < WD_GRACE_MS) return;

  if (heapStrikes >= HEAP_STRIKES) rebootWith("RAM libre baja sostenida");
  // Sin configurar, o con alguien usando el portal, reiniciar no arregla nada
  // y le corta la pagina a quien esta configurando.
  if (!isConfigured() || portalInUse(now)) return;
  if (now - lastOkMs > REBOOT_AFTER_MS)
    rebootWith("sin ping OK por demasiado tiempo");
}

void logStatus() {
  Serial.printf(
      "[estado] up=%lus heap=%u minHeap=%u ok=%lu fallos=%lu rssi=%d wifi=%s ap=%s\n",
      millis() / 1000, ESP.getFreeHeap(), minHeapSeen, pingOk, pingFail,
      WiFi.RSSI(), WiFi.status() == WL_CONNECTED ? "ok" : "caido",
      apActive ? "on" : "off");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== Power Monitor  (fw v%d) ===\n", FW_VERSION);
  Serial.println("[boot] motivo del ultimo reinicio: " + resetReasonText());
  Serial.printf("[boot] heap libre: %u bytes\n", ESP.getFreeHeap());

#if USE_STATUS_LED
  pinMode(STATUS_LED_PIN, OUTPUT);
  setLed(false);
#endif

  loadConfig();
  Serial.printf("[cfg] origen: %s  wifi=%s  hostname=%s  clave OTA: %s\n",
                cfgFromFlash ? "flash (portal)" : "secrets.h",
                cfg.ssid[0] ? cfg.ssid : "(ninguno)", cfg.hostname,
                !cfg.otaPass[0] ? "ninguna"
                : strcmp(cfg.otaPass, OTA_PASSWORD) == 0 ? "la de secrets.h"
                : "cambiada desde el portal");

  WiFi.persistent(false);        // no escribir credenciales a flash en cada begin
#if defined(ESP32)
  WiFi.setHostname(cfg.hostname);  // en ESP32 tiene que ir antes de WiFi.mode()
#endif
  WiFi.mode(WIFI_STA);
#if defined(ESP8266)
  WiFi.hostname(cfg.hostname);
#endif
  WiFi.setAutoReconnect(true);
  applyWifiSleep(cfg.lowPower);

  String mac = WiFi.macAddress();  // "AA:BB:CC:DD:EE:FF" -> sufijo "EEFF"
  apSsid = "ESP32Monitor-" + mac.substring(12, 14) + mac.substring(15, 17);

  // TLS sin validar certificado: simple y suficiente para este uso.
  // Para validar, usar client.setCACert(<root CA de Vercel / ISRG Root X1>).
  hardenTlsClient();

  setupWebServer();

  lastOkMs = millis();           // arranca el reloj del watchdog
  startWifiAttempt();            // no bloquea: handleWifi() sigue el resultado
}

void loop() {
  unsigned long now = millis();

  if (otaReady) ArduinoOTA.handle();
  if (apActive) dns.processNextRequest();
  server.handleClient();

  handleWifi(now);

  if (WiFi.status() != WL_CONNECTED) {
    setLed(((now / 250) % 2) != 0);   // parpadeo mientras no hay WiFi
  } else if (now - lastPingAttempt >= cfg.pingIntervalMs) {
    lastPingAttempt = now;
    sendPing();
  }

  if (now - lastStatusLog >= STATUS_LOG_MS) {
    lastStatusLog = now;
    logStatus();
  }

  if (restartAt && (long)(now - restartAt) >= 0) rebootWith("pedido desde el portal");

  guardWatchdogs();
  delay(10);
}

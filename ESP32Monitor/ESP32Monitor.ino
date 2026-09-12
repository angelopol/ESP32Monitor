/* =============================================================================
 *  ESP32 / ESP8266 Power Monitor  -  firmware
 *
 *  Hace un ping HTTPS al servidor cada PING_INTERVAL_MS. Si el servidor deja de
 *  recibir pings (porque se corto la luz y el equipo se apago) la PWA avisa.
 *
 *  Placas soportadas: ESP32 (clasico y C3) y ESP8266 (NodeMCU, Wemos D1, etc).
 *  El MISMO .ino compila para las dos familias: lo decide la placa que elijas
 *  en Tools > Board. Las diferencias de API entre plataformas estan aisladas
 *  en las funciones resetReasonText(), applyWifiPowerSaving() y hardenTlsClient().
 *
 *  - En el primer ping despues de (re)conectar al WiFi manda &boot=1, para que
 *    el servidor dispare "volvio la luz" al instante.
 *  - Manda &rssi=<dBm> para mostrar la señal en el dashboard.
 *  - OTA: podes subir firmware nuevo por WiFi (Arduino IDE -> puerto de red
 *    "<OTA_HOSTNAME> at x.x.x.x"), sin cable, util una vez instalado.
 *  - Al arrancar imprime el MOTIVO del ultimo reinicio: si el equipo se reinicia
 *    solo, el serial te dice por que en vez de tener que adivinar.
 *
 *  Nota ESP8266: el stack de loop() ("cont stack") es de 4 KB y NO se puede
 *  agrandar de forma confiable desde el .ino (el IDE inserta Arduino.h antes
 *  que cualquier codigo del sketch, asi que un #define CONT_STACKSIZE aca no
 *  llega a tiempo -- si lo intentas vas a ver un warning de "redefined" que
 *  confirma que no sirvio de nada). La mitigacion real para TLS en ESP8266 es
 *  reducir el consumo de RAM de BearSSL, ver hardenTlsClient().
 *
 *  Libs:   ArduinoOTA (comun a ambas plataformas) +
 *          ESP32:   WiFi.h, WiFiClientSecure.h, HTTPClient.h
 *          ESP8266: ESP8266WiFi.h, WiFiClientSecure.h (alias de BearSSL), ESP8266HTTPClient.h
 * ---------------------------------------------------------------------------- */

#if defined(ESP32)
  #include <WiFi.h>
  #include <WiFiClientSecure.h>
  #include <HTTPClient.h>
  #include <esp_system.h>
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <WiFiClientSecure.h>     // en ESP8266 es un alias de BearSSL::WiFiClientSecure
  #include <ESP8266HTTPClient.h>
#else
  #error "Placa no soportada. En Tools > Board elegi un ESP32 (o C3) o un ESP8266."
#endif

#include <ArduinoOTA.h>   // misma API en las dos plataformas

// WIFI_SSID / WIFI_PASS / SERVER_URL / DEVICE_TOKEN / OTA_* viven en secrets.h
// (ignorado por git). Copia secrets.example.h -> secrets.h y completalo.
#include "secrets.h"

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
#define FW_VERSION 3

// LED de estado. APAGADO por defecto: en ESP32-C3 el GPIO2 es strapping pin de
// arranque y moverlo puede impedir el boot; en ESP8266 el LED_BUILTIN suele
// ser activo en LOW (al reves que en ESP32). Si tu placa tiene un LED simple
// en un pin seguro, pone esto en 1 y ajusta STATUS_LED_PIN.
#define USE_STATUS_LED 0
#define STATUS_LED_PIN 2

// Ahorro de energia del WiFi. true = menor consumo (recomendado: si el equipo
// se reinicia solo, casi siempre es la fuente que no aguanta los picos).
// false = reconexion un pelo mas rapida pero varias veces mas consumo continuo.
#define WIFI_LOW_POWER true

const unsigned long PING_INTERVAL_MS = 5000;      // cada cuanto pinguear
const unsigned long HTTP_TIMEOUT_MS  = 4000;      // timeout por request
const unsigned long WIFI_RETRY_MS    = 10000;     // reintento de WiFi
const unsigned long STATUS_LOG_MS    = 60000;     // resumen por serial

// --- Watchdogs (conservadores: reiniciar es el ultimo recurso) ---
const unsigned long REBOOT_AFTER_MS  = 15UL * 60 * 1000;  // sin ping OK -> reboot
const unsigned long WD_GRACE_MS      = 5UL  * 60 * 1000;  // no reiniciar antes de esto
const uint32_t      MIN_FREE_HEAP    = 8000;      // bytes
const uint8_t       HEAP_STRIKES     = 20;        // lecturas bajas seguidas para actuar
// ---------------------------------------------------------------------------

WiFiClientSecure client;

unsigned long lastPingAttempt = 0;
unsigned long lastWifiTry     = 0;
unsigned long lastOkMs        = 0;   // ultimo ping con respuesta HTTP del server
unsigned long lastStatusLog   = 0;
unsigned long pingOk = 0, pingFail = 0;
uint32_t minHeapSeen  = UINT32_MAX;
uint8_t  heapStrikes  = 0;
bool bootPing     = true;            // el proximo ping lleva &boot=1
bool wasConnected = false;
bool otaReady     = false;

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

void applyWifiPowerSaving() {
#if defined(ESP32)
  WiFi.setSleep(WIFI_LOW_POWER);
#elif defined(ESP8266)
  WiFi.setSleepMode(WIFI_LOW_POWER ? WIFI_MODEM_SLEEP : WIFI_NONE_SLEEP);
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

void setupOTA() {
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() { Serial.println("[ota] iniciando actualizacion"); });
  ArduinoOTA.onEnd([]() { Serial.println("\n[ota] fin"); });
  ArduinoOTA.onError([](ota_error_t e) { Serial.printf("[ota] error %u\n", e); });
  ArduinoOTA.begin();
  otaReady = true;
  Serial.printf("[ota] listo en %s.local\n", OTA_HOSTNAME);
}

void connectWiFi() {
  lastWifiTry = millis();
  Serial.printf("[wifi] conectando a %s ...\n", WIFI_SSID);
  WiFi.disconnect();             // limpia estado previo (sin borrar config)
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] OK  ip=%s  rssi=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    if (!wasConnected) bootPing = true;   // (re)conecto -> marcar boot
    wasConnected = true;
    if (!otaReady) setupOTA();
  } else {
    Serial.println("[wifi] fallo, reintenta luego");
    wasConnected = false;
  }
}

void sendPing() {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String(SERVER_URL) + "/api/ping?token=" + DEVICE_TOKEN +
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
  if (millis() < WD_GRACE_MS) return;

  if (heapStrikes >= HEAP_STRIKES) rebootWith("RAM libre baja sostenida");
  if (millis() - lastOkMs > REBOOT_AFTER_MS)
    rebootWith("sin ping OK por demasiado tiempo");
}

void logStatus() {
  Serial.printf(
      "[estado] up=%lus heap=%u minHeap=%u ok=%lu fallos=%lu rssi=%d wifi=%s\n",
      millis() / 1000, ESP.getFreeHeap(), minHeapSeen, pingOk, pingFail,
      WiFi.RSSI(), WiFi.status() == WL_CONNECTED ? "ok" : "caido");
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

  WiFi.persistent(false);        // no escribir credenciales a flash en cada begin
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  applyWifiPowerSaving();

  // TLS sin validar certificado: simple y suficiente para este uso.
  // Para validar, usar client.setCACert(<root CA de Vercel / ISRG Root X1>).
  hardenTlsClient();

  lastOkMs = millis();           // arranca el reloj del watchdog
  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  if (otaReady) ArduinoOTA.handle();

  if (WiFi.status() != WL_CONNECTED) {
    wasConnected = false;
    setLed(((now / 250) % 2) != 0);   // parpadeo mientras no hay WiFi
    if (now - lastWifiTry >= WIFI_RETRY_MS) connectWiFi();
  } else if (now - lastPingAttempt >= PING_INTERVAL_MS) {
    lastPingAttempt = now;
    sendPing();
  }

  if (now - lastStatusLog >= STATUS_LOG_MS) {
    lastStatusLog = now;
    logStatus();
  }

  guardWatchdogs();
  delay(50);
}

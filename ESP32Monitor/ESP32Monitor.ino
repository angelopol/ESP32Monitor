/* =============================================================================
 *  ESP32 Power Monitor  -  firmware
 *
 *  Hace un ping HTTPS al servidor cada PING_INTERVAL_MS. Si el servidor deja de
 *  recibir pings (porque se corto la luz y el ESP32 se apago) la PWA avisa.
 *
 *  - En el primer ping despues de (re)conectar al WiFi manda &boot=1, para que
 *    el servidor dispare "volvio la luz" al instante.
 *  - Manda &rssi=<dBm> para mostrar la señal en el dashboard.
 *  - OTA: podes subir firmware nuevo por WiFi (Arduino IDE -> puerto de red
 *    "<OTA_HOSTNAME> at x.x.x.x"), sin cable, util una vez instalado.
 *  - Auto-reinicio si no logra pingear con exito durante REBOOT_AFTER_MS, o si
 *    la RAM libre cae por debajo de MIN_FREE_HEAP (fugas/fragmentacion a la larga).
 *
 *  Placa:  ESP32 Dev Module (o similar).
 *  Libs:   WiFi, WiFiClientSecure, HTTPClient, ArduinoOTA  (todas del core ESP32).
 * ---------------------------------------------------------------------------- */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoOTA.h>

// WIFI_SSID / WIFI_PASS / SERVER_URL / DEVICE_TOKEN / OTA_* viven en secrets.h
// (ignorado por git). Copiá secrets.example.h -> secrets.h y completalo.
#include "secrets.h"

// ----------------------------- CONFIGURACION ---------------------------------
// Subí este número en cada cambio: al arrancar lo imprime, así confirmás que la
// actualización OTA entró.
#define FW_VERSION 1

const unsigned long PING_INTERVAL_MS = 5000;      // cada cuanto pinguear
const unsigned long HTTP_TIMEOUT_MS  = 4000;      // timeout por request
const unsigned long WIFI_RETRY_MS    = 10000;     // reintento de WiFi
const unsigned long REBOOT_AFTER_MS  = 10UL * 60 * 1000;  // sin ping OK -> reboot
const uint32_t      MIN_FREE_HEAP    = 15000;     // bytes; por debajo -> reboot
// ---------------------------------------------------------------------------

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

WiFiClientSecure client;

unsigned long lastPingAttempt = 0;
unsigned long lastWifiTry     = 0;
unsigned long lastOkMs        = 0;   // ultimo ping con respuesta HTTP del server
bool bootPing     = true;            // el proximo ping lleva &boot=1
bool wasConnected = false;
bool otaReady     = false;

void setLed(bool on) { digitalWrite(LED_BUILTIN, on ? HIGH : LOW); }

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
  http.setReuse(false);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    Serial.println("[ping] http.begin fallo");
    return;
  }

  int code = http.GET();
  Serial.printf("[ping] %d %s  heap=%u\n",
                code, bootPing ? "(boot)" : "", ESP.getFreeHeap());

  if (code > 0) {
    lastOkMs = millis();          // hubo ida y vuelta con el server
    setLed(true);
    if (code == 200) bootPing = false;
  } else {
    setLed(false);
  }

  http.end();
  client.stop();                  // cierra la conexion TLS, libera recursos
}

void guardWatchdogs() {
  if (millis() - lastOkMs > REBOOT_AFTER_MS) {
    Serial.println("[wd] sin ping OK por demasiado tiempo -> reinicio");
    delay(100);
    ESP.restart();
  }
  if (ESP.getFreeHeap() < MIN_FREE_HEAP) {
    Serial.println("[wd] RAM libre baja -> reinicio");
    delay(100);
    ESP.restart();
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== ESP32 Power Monitor  (fw v%d) ===\n", FW_VERSION);

  pinMode(LED_BUILTIN, OUTPUT);
  setLed(false);

  WiFi.persistent(false);        // no escribir credenciales a flash en cada begin
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);          // dispositivo a red fija: sin modem-sleep

  // TLS sin validar certificado: simple y suficiente para este uso.
  // Para validar, usar client.setCACert(<root CA de Vercel / ISRG Root X1>).
  client.setInsecure();

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
    guardWatchdogs();
    delay(50);
    return;
  }

  if (now - lastPingAttempt >= PING_INTERVAL_MS) {
    lastPingAttempt = now;
    sendPing();
  }

  guardWatchdogs();
  delay(50);
}

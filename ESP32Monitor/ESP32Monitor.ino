/* =============================================================================
 *  ESP32 Power Monitor  -  firmware
 *
 *  Hace un ping HTTPS al servidor cada PING_INTERVAL_MS. Si el servidor deja de
 *  recibir pings (porque se corto la luz y el ESP32 se apago) la PWA avisa.
 *
 *  - En el primer ping despues de (re)conectar al WiFi manda &boot=1, para que
 *    el servidor dispare "volvio la luz" al instante.
 *  - Manda &rssi=<dBm> para mostrar la señal en el dashboard.
 *
 *  Placa:  ESP32 Dev Module (o similar).
 *  Libs:   WiFi, WiFiClientSecure, HTTPClient  (vienen con el core de ESP32).
 * ---------------------------------------------------------------------------- */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// WIFI_SSID / WIFI_PASS / SERVER_URL / DEVICE_TOKEN viven en secrets.h
// (ignorado por git). Copiá secrets.example.h -> secrets.h y completalo.
#include "secrets.h"

// ----------------------------- CONFIGURACION ---------------------------------
const unsigned long PING_INTERVAL_MS = 5000;   // cada cuanto pinguear
const unsigned long HTTP_TIMEOUT_MS = 4000;    // timeout por request
const unsigned long WIFI_RETRY_MS = 10000;     // reintento de WiFi
// ---------------------------------------------------------------------------

WiFiClientSecure client;
unsigned long lastPing = 0;
unsigned long lastWifiTry = 0;
bool bootPing = true;          // el proximo ping lleva &boot=1
bool wasConnected = false;

void connectWiFi() {
  lastWifiTry = millis();
  Serial.printf("[wifi] conectando a %s ...\n", WIFI_SSID);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
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
    if (!wasConnected) bootPing = true;   // reconecto -> marcar boot
    wasConnected = true;
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
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    Serial.println("[ping] http.begin fallo");
    return;
  }

  int code = http.GET();
  Serial.printf("[ping] %d %s\n", code, bootPing ? "(boot)" : "");

  if (code == 200) {
    bootPing = false;                 // ya avisamos el arranque
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== ESP32 Power Monitor ===");

  // TLS sin validar certificado: simple y suficiente para este uso.
  // Para validar, usar client.setCACert(<root CA de Vercel/LetsEncrypt>).
  client.setInsecure();

  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    wasConnected = false;
    if (now - lastWifiTry >= WIFI_RETRY_MS) connectWiFi();
    delay(50);
    return;
  }

  if (now - lastPing >= PING_INTERVAL_MS) {
    lastPing = now;
    sendPing();
  }

  delay(50);
}

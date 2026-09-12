/* =============================================================================
 *  MonitorLite  -  sketch de DIAGNOSTICO, no el firmware real.
 *
 *  Compila para ESP32 (clasico y C3) y ESP8266: lo decide la placa que elijas
 *  en Tools > Board. Objetivo: aislar por etapas que parte del programa
 *  dispara los reinicios, en CUALQUIERA de los dos chips.
 *
 *  Nota ESP8266: el stack de loop() ("cont stack", 4 KB por defecto) NO se
 *  puede agrandar de forma confiable con un #define en el .ino -- el IDE
 *  inserta Arduino.h antes que el codigo del sketch, asi que llega tarde (da
 *  un warning de "redefined" sin ningun efecto real). Si en STAGE 4 el
 *  ESP8266 falla y sospechas del stack/RAM de TLS, la mitigacion real es
 *  bajar aun mas los buffers de BearSSL (setBufferSizes) mas abajo.
 *
 *  A proposito NO tiene: OTA, watchdogs propios, ESP.restart(), ni logica de
 *  la app. Si esto se reinicia solo, el reinicio es 100% real (brownout,
 *  panic, watchdog del sistema) y no algo que programamos nosotros.
 *
 *  COMO USARLO
 *  -----------
 *  1) Dejá STAGE en 1, subilo, conectá el equipo a SU fuente/cable definitivo
 *     (no al USB de la PC), y dejalo un rato largo (10-20 min minimo).
 *     Si en STAGE 1 igual se reinicia solo -> el problema es la placa o la
 *     fuente, ni siquiera llega a tocar WiFi.
 *  2) Si STAGE 1 aguanta, subi STAGE 2 (enciende WiFi, sin hacer HTTP).
 *     Si se reinicia aca -> es la RADIO (consumo/antena/fuente), no el codigo
 *     de red.
 *  3) Si STAGE 2 aguanta, subi STAGE 3 (HTTP plano, sin TLS).
 *     Si se reinicia aca -> problema en HTTPClient / heap, no en TLS.
 *  4) Si STAGE 3 aguanta, subi STAGE 4 (HTTPS real, igual que el firmware
 *     final, pega directo a tu servidor). Si se reinicia SOLO aca -> el
 *     sospechoso es el handshake TLS (stack/heap, mas justo aun en ESP8266).
 *
 *  Corré la MISMA secuencia en el ESP32 y en el ESP8266 con el mismo cable y
 *  cargador: si los dos se reinician en la misma etapa, es la fuente. Si solo
 *  uno de los dos falla, es especifico de ese chip/core.
 *
 *  Cada vez que arranca (incluso recien reiniciado solo) imprime POR QUE
 *  se reinicio la ultima vez. Esa linea es la respuesta.
 *
 *  IMPORTANTE: mirá también las primeras líneas que imprime el propio chip
 *  ANTES de "=== MonitorLite ===" (vienen del bootloader, mismo baud 115200).
 *  En ESP32 si dice "Brownout detector was triggered" ya tenés la causa. En
 *  ESP8266 no hay ese mensaje especifico, pero un reset "Power On" repetido
 *  sin que vos lo hayas desenchufado tambien apunta a la alimentacion.
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

#include "secrets.h"   // WIFI_SSID / WIFI_PASS / SERVER_URL / DEVICE_TOKEN

// ============================= ELEGI LA ETAPA ================================
#define STAGE 1
// 1 = nada de WiFi. Solo Serial + heap. Baseline.
// 2 = + conectar WiFi y mantenerlo. Sin ninguna request.
// 3 = + 1 request HTTP PLANO (sin TLS) cada 5s a http://example.com
// 4 = + 1 request HTTPS real a tu servidor (como el firmware de produccion)
// ===============================================================================

// Interruptor de diagnostico SOLO PARA ESP32: apaga el detector de brownout
// por software. Si con esto en 1 el chip deja de "reiniciarse" y en cambio se
// cuelga/hace cosas raras -> confirma que ERA brownout (fuente). En ESP8266 no
// existe un equivalente simple expuesto por Arduino, asi que este interruptor
// no hace nada en esa plataforma.
// NUNCA dejar esto en 1 en el firmware final: sin el detector, un bajon real
// de voltaje puede corromper la flash en vez de reiniciar limpio.
#define DISABLE_BROWNOUT_FOR_TEST 0

#if defined(ESP32) && DISABLE_BROWNOUT_FOR_TEST
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#endif

const unsigned long INTERVAL_MS = (STAGE <= 2) ? 2000 : 5000;
unsigned long lastAction = 0;
unsigned long okCount = 0, failCount = 0;
uint32_t minHeapSeen = UINT32_MAX;

void trackHeap() {
  uint32_t heap = ESP.getFreeHeap();
  if (heap < minHeapSeen) minHeapSeen = heap;
}

String resetReasonText() {
#if defined(ESP32)
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "POWERON (se corto/volvio la alimentacion, o power-on normal)";
    case ESP_RST_EXT:       return "EXT (reset externo / boton)";
    case ESP_RST_SW:        return "SW (ESP.restart() -- este sketch no llama a eso)";
    case ESP_RST_PANIC:     return "PANIC (crash / excepcion del firmware)";
    case ESP_RST_INT_WDT:   return "INT_WDT (watchdog de interrupciones -> algo bloqueo el core)";
    case ESP_RST_TASK_WDT:  return "TASK_WDT (watchdog de tarea -> loop() no volvio a tiempo)";
    case ESP_RST_WDT:       return "WDT (otro watchdog)";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "BROWNOUT <-- LA FUENTE/CABLE NO AGUANTA EL CONSUMO";
    case ESP_RST_SDIO:      return "SDIO";
    default:                return "DESCONOCIDO";
  }
#elif defined(ESP8266)
  // "Power On", "External System", "Software/System restart", "Exception",
  // "Watchdog", "Hardware Watchdog", "Deep-Sleep Wake", "Turn on boot"...
  return ESP.getResetReason() + " (motivo crudo, ver comentario del header)";
#endif
}

void printBanner() {
#if defined(ESP32)
  const char *chip = "ESP32";
#elif defined(ESP8266)
  const char *chip = "ESP8266";
#endif
  Serial.printf("\n=== MonitorLite  chip=%s  STAGE=%d ===\n", chip, STAGE);
  Serial.println("[boot] motivo del ultimo reinicio: " + resetReasonText());
  Serial.printf("[boot] heap libre: %u bytes\n", ESP.getFreeHeap());
#if defined(ESP32) && DISABLE_BROWNOUT_FOR_TEST
  Serial.println("[boot] *** BROWNOUT DETECTOR DESACTIVADO (solo diagnostico) ***");
#endif
}

#if STAGE >= 2
void connectWiFi() {
  Serial.printf("[wifi] conectando a %s ...\n", WIFI_SSID);
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
  } else {
    Serial.println("[wifi] no conecto (sigue intentando en el loop)");
  }
}
#endif

#if STAGE == 3
void doPlainHttp() {
  HTTPClient http;
  http.setTimeout(4000);
#if defined(ESP32)
  http.setConnectTimeout(4000);
#endif
  if (!http.begin("http://example.com/")) {
    Serial.println("[http] begin fallo");
    failCount++;
    return;
  }
  int code = http.GET();
  if (code > 0) okCount++; else failCount++;
  trackHeap();
  Serial.printf("[http] codigo=%d ok=%lu fail=%lu heap=%u minHeap=%u\n",
                code, okCount, failCount, ESP.getFreeHeap(), minHeapSeen);
  http.end();
}
#endif

#if STAGE == 4
WiFiClientSecure client;

void doHttpsPing() {
  String url = String(SERVER_URL) + "/api/ping?token=" + DEVICE_TOKEN + "&lite=1";
  HTTPClient http;
  http.setTimeout(4000);
#if defined(ESP32)
  http.setConnectTimeout(4000);
#endif
  if (!http.begin(client, url)) {
    Serial.println("[https] begin fallo");
    failCount++;
    return;
  }
  int code = http.GET();
  if (code > 0) okCount++; else failCount++;
  trackHeap();
  Serial.printf("[https] codigo=%d ok=%lu fail=%lu heap=%u minHeap=%u\n",
                code, okCount, failCount, ESP.getFreeHeap(), minHeapSeen);
  http.end();
  client.stop();
}
#endif

void setup() {
  Serial.begin(115200);
  delay(300);

#if defined(ESP32) && DISABLE_BROWNOUT_FOR_TEST
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);   // OJO: ver advertencia arriba
#endif

  printBanner();

#if STAGE >= 2
  connectWiFi();
#endif
#if STAGE == 4
  client.setInsecure();
#if defined(ESP8266)
  client.setBufferSizes(1024, 1024);   // BearSSL usa mucha RAM; el ESP8266 tiene poca
#endif
#endif
}

void loop() {
  unsigned long now = millis();

#if STAGE == 1
  // Nada de red: solo confirmar que el chip/la fuente aguantan estando quieto.
  if (now - lastAction >= INTERVAL_MS) {
    lastAction = now;
    trackHeap();
    Serial.printf("[s1] up=%lus heap=%u minHeap=%u\n",
                  now / 1000, ESP.getFreeHeap(), minHeapSeen);
  }
#endif

#if STAGE == 2
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  } else if (now - lastAction >= INTERVAL_MS) {
    lastAction = now;
    trackHeap();
    Serial.printf("[s2] up=%lus heap=%u minHeap=%u rssi=%d\n",
                  now / 1000, ESP.getFreeHeap(), minHeapSeen, WiFi.RSSI());
  }
#endif

#if STAGE == 3
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  } else if (now - lastAction >= INTERVAL_MS) {
    lastAction = now;
    doPlainHttp();
  }
#endif

#if STAGE == 4
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  } else if (now - lastAction >= INTERVAL_MS) {
    lastAction = now;
    doHttpsPing();
  }
#endif

  delay(50);
}

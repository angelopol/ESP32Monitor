#pragma once
// ===========================================================================
//  Plantilla de datos privados. Copiá este archivo a  secrets.h  y completá
//  tus valores. secrets.h está en .gitignore y NO se sube a GitHub.
//
//  Son solo los valores POR DEFECTO: todo se puede cambiar después desde la
//  página de configuración del equipo (http://esp32monitor.local, o el punto
//  de acceso "ESP32Monitor-XXXX" que aparece cuando no logra conectarse).
//  secrets.h es opcional: sin él, el equipo arranca directo en modo punto de
//  acceso para que lo configures desde el teléfono.
// ===========================================================================

#define WIFI_SSID     "TU_WIFI"
#define WIFI_PASS     "TU_PASSWORD"

// Sin barra final. Ej: "https://mi-monitor.vercel.app"
#define SERVER_URL    "https://TU-APP.vercel.app"

// Token del dispositivo: se genera al crear el dispositivo en la app web
// (botón "Conexión ESP32" de la tarjeta). Cada dispositivo tiene el suyo.
#define DEVICE_TOKEN  "pega-aca-el-token-del-dispositivo"

// --- Actualización por WiFi (OTA) ---
// Nombre en la red (podrás subir firmware a  <OTA_HOSTNAME>.local ) y clave
// para autorizar esas actualizaciones. Elegí una clave propia.
#define OTA_HOSTNAME  "esp32monitor"
#define OTA_PASSWORD  "elegi-una-clave-para-OTA"

// --- Punto de acceso de configuración (opcional) ---
// Por defecto es una red ABIERTA. Si preferís ponerle clave (mínimo 8
// caracteres), descomentá esta línea.
// #define AP_PASSWORD  "clave-del-punto-de-acceso"

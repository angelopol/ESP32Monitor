#pragma once
// ===========================================================================
//  Plantilla de datos privados. Copiá este archivo a  secrets.h  y completá
//  tus valores. secrets.h está en .gitignore y NO se sube a GitHub.
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

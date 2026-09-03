/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hay otros lockfiles arriba en el arbol de carpetas; fijamos la raiz aca.
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [
      {
        // El service worker no debe cachearse y necesita poder controlar toda la raíz.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;

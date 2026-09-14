import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

// Splash screens de arranque para iOS (Safari no genera esto solo: hay que
// declarar cada tamaño con su media query). Generados por scripts/gen-icons.mjs.
const APPLE_SPLASH = [
  { file: "iphone-se-2x", w: 375, h: 667, dpr: 2 },
  { file: "iphone-6.1-3x", w: 390, h: 844, dpr: 3 },
  { file: "iphone-15-16-3x", w: 393, h: 852, dpr: 3 },
  { file: "iphone-6.7-3x", w: 430, h: 932, dpr: 3 },
].map(({ file, w, h, dpr }) => ({
  rel: "apple-touch-startup-image",
  url: `/splash/${file}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}));

export const metadata: Metadata = {
  title: "Monitor de Luz",
  description: "Avisa cuando se corta la electricidad en casa usando un ESP32.",
  manifest: "/manifest.webmanifest",
  applicationName: "Monitor de Luz",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Monitor de Luz",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    // iOS/iPadOS ignora el manifest para el icono de inicio: necesita este link explícito.
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    other: APPLE_SPLASH,
  },
  formatDetection: { telephone: false },
  other: {
    // Next ya emite "mobile-web-app-capable" (sin prefijo) via appleWebApp.capable,
    // que es lo que exige iOS 15.4+. En iOS más viejo Safari solo reconoce el
    // nombre con prefijo -apple-, así que lo agregamos a mano para no dejar
    // afuera esos dispositivos.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  // Igual que background_color/theme_color del manifest: evita un flash de
  // color distinto entre la pantalla de arranque y la barra de estado.
  themeColor: "#0f172a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Nunca deshabilitar el zoom: gente con baja visión depende de poder
  // agrandar (WCAG 1.4.4). Safari/Chrome ya evitan el auto-zoom porque el
  // texto base es >=16px (ver globals.css).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={jakarta.variable}>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}

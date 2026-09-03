import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

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
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}

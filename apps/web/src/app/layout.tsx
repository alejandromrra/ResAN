import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResAN",
  description: "Carta QR y pedidos en mesa",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#c2410c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}

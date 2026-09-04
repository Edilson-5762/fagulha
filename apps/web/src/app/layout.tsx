import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ServiceWorker } from "./service-worker.js";

// Canonical public origin, used to turn the generated opengraph-image into an
// absolute URL that WhatsApp & friends can fetch. Set NEXT_PUBLIC_SITE_URL in
// the deploy environment to the real domain (e.g. https://fagulha.vercel.app).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fagulha.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Fagulha",
  title: {
    default: "Fagulha",
    template: "%s · Fagulha"
  },
  description:
    "Transfira arquivos com segurança entre seus dispositivos. Conexão direta P2P, sem instalar nada e sem armazenar arquivos nos servidores.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Fagulha",
    statusBarStyle: "black-translucent"
  },
  openGraph: {
    type: "website",
    siteName: "Fagulha",
    locale: "pt_BR",
    title: "Fagulha — transferência de arquivos P2P",
    description:
      "Transfira arquivos com segurança entre seus dispositivos. Conexão direta, sem armazenar nada nos servidores."
  },
  twitter: {
    card: "summary_large_image",
    title: "Fagulha — transferência de arquivos P2P",
    description: "Transfira arquivos com segurança entre seus dispositivos."
  }
};

export const viewport: Viewport = {
  themeColor: "#0a0e17"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-bg font-sans text-text antialiased" suppressHydrationWarning>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

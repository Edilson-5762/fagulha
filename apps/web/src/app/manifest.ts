import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Makes the site installable: "Adicionar à
// tela inicial" (iOS) and the "Instalar app" prompt (Android/desktop Chrome,
// which also needs the service worker registered in ./service-worker.tsx).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fagulha",
    short_name: "Fagulha",
    description:
      "Transferência de arquivos segura e direta entre seus dispositivos, sem armazenar nada nos servidores.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["utilities", "productivity"],
    background_color: "#0a0e17",
    theme_color: "#0a0e17",
    icons: [
      { src: "/pwa-icon-192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon-512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}

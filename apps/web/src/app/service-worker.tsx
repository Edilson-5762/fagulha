"use client";

import { useEffect } from "react";

/**
 * Registers the minimal service worker (`/sw.js`). It carries no offline logic
 * of its own — its only job is to exist so Chrome offers the "Instalar app"
 * prompt. If registration fails the app keeps working, just without the prompt.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

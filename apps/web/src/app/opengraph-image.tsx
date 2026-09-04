import { ImageResponse } from "next/og";
import { BrandMark } from "../lib/brand-mark.js";

export const alt = "Fagulha — transfira arquivos com segurança entre seus dispositivos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Link-preview card shown by WhatsApp, Telegram, Signal, Discord, Slack, etc.
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 72,
        padding: "0 96px",
        background: "#0a0e17",
        backgroundImage:
          "radial-gradient(circle at 20% 35%, rgba(79,140,255,0.22), transparent 55%)"
      }}
    >
      <BrandMark size={300} background />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 92, fontWeight: 700, color: "#f4f6fb", letterSpacing: -2 }}>
          Fagulha
        </div>
        <div
          style={{
            fontSize: 40,
            color: "#8b93a7",
            marginTop: 16,
            maxWidth: 620,
            lineHeight: 1.3
          }}
        >
          Transfira arquivos com segurança entre seus dispositivos.
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "#4f8cff",
            marginTop: 36,
            letterSpacing: 3,
            textTransform: "uppercase"
          }}
        >
          Rápido · Seguro · Direto
        </div>
      </div>
    </div>,
    { ...size }
  );
}

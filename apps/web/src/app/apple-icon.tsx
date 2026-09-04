import { ImageResponse } from "next/og";
import { BrandMark } from "../lib/brand-mark.js";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon for iOS. iOS applies its own rounded mask, so we render a
// full-bleed navy plate with the mark inset inside the safe area.
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0e17"
      }}
    >
      <BrandMark size={148} />
    </div>,
    { ...size }
  );
}

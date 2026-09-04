import { ImageResponse } from "next/og";
import { BrandMark } from "../../lib/brand-mark.js";

export const dynamic = "force-static";

// "maskable": Android crops the icon to its own shape, so the artwork must sit
// inside a safe zone (~10% padding) on a full-bleed navy plate.
export function GET() {
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
      <BrandMark size={392} />
    </div>,
    { width: 512, height: 512 }
  );
}

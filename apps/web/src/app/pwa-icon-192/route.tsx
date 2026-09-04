import { ImageResponse } from "next/og";
import { BrandMark } from "../../lib/brand-mark.js";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<BrandMark size={192} background />, { width: 192, height: 192 });
}

import { ImageResponse } from "next/og";
import { BrandMark } from "../../lib/brand-mark.js";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(<BrandMark size={512} background />, { width: 512, height: 512 });
}

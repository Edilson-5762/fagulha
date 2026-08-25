import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@transfergo/shared", "@transfergo/ui"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"]
    }
  }
};

export default nextConfig;

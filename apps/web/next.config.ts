import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@fagulha/shared", "@fagulha/ui"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"]
    }
  }
};

export default nextConfig;

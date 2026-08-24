import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@transfergo/shared", "@transfergo/ui"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"]
    }
  }
};

export default nextConfig;

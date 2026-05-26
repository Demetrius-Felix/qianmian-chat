import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo: let Next transpile workspace packages
  transpilePackages: ["@qianmian/shared"],
  // Silence multi-lockfile / wrong root inference on Windows
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;

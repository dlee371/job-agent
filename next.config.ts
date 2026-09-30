import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright and the Anthropic SDK are Node-only; keep them out of the bundler.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;

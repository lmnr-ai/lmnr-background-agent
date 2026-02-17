import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@lmnr-ai/lmnr",
  ],
};

export default nextConfig;

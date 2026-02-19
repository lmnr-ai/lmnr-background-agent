import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@lmnr-ai/lmnr",
    "better-sqlite3",
  ],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        "ubiquitous-journey-r4j7475vjv7w35wr6-3000.app.github.dev",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;

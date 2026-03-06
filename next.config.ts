import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // Increase API body size limit and response timeout for video downloads
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  // Required headers for FFmpeg.wasm (SharedArrayBuffer needs COOP/COEP)
  // IMPORTANT: Exclude /api/proxy from COOP/COEP — those headers block
  // mobile downloads (iOS Safari / Android Chrome silently fail to save files
  // when the response comes from a cross-origin-isolated context).
  async headers() {
    return [
      {
        // Apply COOP/COEP only to non-API pages (where FFmpeg.wasm loads)
        source: "/((?!api/).*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;

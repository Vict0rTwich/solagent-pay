import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the dev-tools badge off the sidebar footer.
  devIndicators: { position: "bottom-right" },
  async redirects() {
    // A short address for the register, to type on a counter tablet.
    return [{ source: "/pos", destination: "/dashboard/pos", permanent: false }];
  },
  async rewrites() {
    // Solana Actions clients look for /actions.json; some tooling looks under /.well-known. Same file for both.
    return [{ source: "/.well-known/actions.json", destination: "/actions.json" }];
  },
};

export default nextConfig;

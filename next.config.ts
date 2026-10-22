import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.BTM_NEXT_DIST_DIR || ".next",
  /**
   * Next 16 blocks dev resources (including the client bundle) for hosts that
   * are not listed here. Automated browser tests connect via 127.0.0.1 while
   * the dev server advertises localhost, so both are allowed.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * pino and thread-stream resolve worker paths at runtime, which the bundler
   * cannot trace — bundling them produces a broken logger at boot. The pg and
   * socket.io stacks are native/CJS and likewise belong outside the bundle.
   */
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "thread-stream",
    "pg",
    "socket.io",
    "ioredis",
    "bullmq",
  ],

  images: {
    /**
     * Lot artwork is generated SVG served from /public. Next refuses to
     * optimise SVG by default because a hostile SVG can carry script — safe
     * here because every file is produced by our own generator, never
     * user-uploaded, and CSP below keeps it inert regardless.
     */
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [],
  },

  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
};

export default nextConfig;

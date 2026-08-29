import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * `unsafe-inline` on scripts is unavoidable without wiring a nonce through
 * every render: Next ships hydration bootstrap inline. It is still worth
 * setting, because the directives that actually close doors here are
 * `frame-ancestors` (clickjacking), `object-src` (plugin-borne script),
 * `base-uri` (base-tag injection) and `form-action` (credential exfiltration
 * to a third-party host). `unsafe-eval` is dev-only — Turbopack's HMR needs it,
 * the production bundle does not.
 *
 * `img-src https:` is deliberately broad: sellers supply lot image URLs, so any
 * https host is a legitimate source. Those URLs are only ever rendered in an
 * <img>, where a hostile SVG cannot execute.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  /** Do not advertise the framework and version to every scanner that asks. */
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Two years, preloadable. Traefik terminates TLS, so this is the only
          // place the policy can be declared.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },

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

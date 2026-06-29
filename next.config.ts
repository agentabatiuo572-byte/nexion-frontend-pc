import type { NextConfig } from "next";

/**
 * Security headers — applied to every route. Demo-safe baseline for an internal
 * Ops Console prototype (clickjacking / MIME sniff / referrer leak hardening).
 *
 * CSP is split by env:
 *   - dev:  allows 'unsafe-eval' (Next.js dev runtime / HMR / React Refresh need it).
 *   - prod: drops 'unsafe-eval' to remove that XSS surface.
 * Both keep 'unsafe-inline' on script-src because Next inlines its runtime bootstrap.
 */
const IS_PROD = process.env.NODE_ENV === "production";

const CSP_SCRIPT_SRC = IS_PROD
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP_CONNECT_SRC = IS_PROD
  ? "connect-src 'self' https://api.fontshare.com"
  : "connect-src 'self' http: https: ws: wss:";

const MEDIA_PREVIEW_ORIGINS = Array.from(new Set([
  "http://127.0.0.1:9000",
  "http://localhost:9000",
  ...(process.env.NEXION_MEDIA_PREVIEW_ORIGINS || "")
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean),
]));

const CSP_MEDIA_PREVIEW_SRC = MEDIA_PREVIEW_ORIGINS.join(" ");

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      CSP_SCRIPT_SRC,
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
      `img-src 'self' data: blob: https: ${CSP_MEDIA_PREVIEW_SRC}`,
      `media-src 'self' data: blob: https: ${CSP_MEDIA_PREVIEW_SRC}`,
      "font-src 'self' data: https://cdn.fontshare.com https://api.fontshare.com",
      CSP_CONNECT_SRC,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  ...(IS_PROD
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.8.6", "192.168.8.45", "192.168.8.48", "192.168.8.102", "192.168.8.103"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/growth/milestones",
        destination: "/growth/daily",
        permanent: false,
      },
      {
        source: "/content/disclosure",
        destination: "/content/trust",
        permanent: false,
      },
      {
        source: "/content/learn",
        destination: "/content/i18n",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

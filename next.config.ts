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

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      CSP_SCRIPT_SRC,
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://cdn.fontshare.com https://api.fontshare.com",
      "connect-src 'self' https://api.fontshare.com",
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
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;

import { fileURLToPath } from "node:url";
import path from "node:path";

// Monorepo root (two levels up from apps/admin). Needed so Next's standalone file tracing
// follows hoisted node_modules up to the repo root instead of stopping at apps/admin —
// otherwise the standalone bundle is missing deps at runtime. See Dockerfile.admin (ADMIN_CONTRACT §6).
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Security headers ─────────────────────────────────────────────────────────
// CSP allows: same-origin; the REST API base (NEXT_PUBLIC_API_BASE); and Google Identity
// Services (optional Google login on /login). Admin has no WebSocket / Gemini-Live surface.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";
const GSI_ORIGIN = "https://accounts.google.com";
const GSI_SCRIPT = "https://accounts.google.com/gsi/client";
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc} ${GSI_SCRIPT} ${GSI_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_BASE} ${GSI_ORIGIN}`,
  `frame-src 'self' ${GSI_ORIGIN}`,
  `child-src 'self' ${GSI_ORIGIN}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "microphone=(), camera=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Self-contained server output for Docker: emits .next/standalone/<...>/apps/admin/server.js.
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;

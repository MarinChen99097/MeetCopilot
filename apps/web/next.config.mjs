import { fileURLToPath } from "node:url";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl request config lives at ./i18n/request.ts (plugin default path).
const withNextIntl = createNextIntlPlugin();

// Monorepo root (two levels up from apps/web). Needed so Next's standalone file
// tracing follows the workspace symlinks (@meetcopilot/shared) and hoisted
// node_modules up to the repo root instead of stopping at apps/web — otherwise
// the standalone bundle is missing deps at runtime. See Dockerfile.web.
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Security headers (M5 §A) ────────────────────────────────────────────────
// CSP allows: same-origin; the REST API base (NEXT_PUBLIC_API_BASE) + its ws(s) origin (realtime copilot
// WebSocket); and Gemini Live (the /train voice bridge connects the browser DIRECTLY to Google — see
// lib/train/liveClient.ts). Kept deliberately non-breaking: 'unsafe-inline'/'unsafe-eval' for scripts in dev
// (Next HMR/runtime) and 'unsafe-inline' styles (Tailwind/next-intl inject inline styles).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";
const WS_BASE = API_BASE.replace(/^http/, "ws"); // http→ws, https→wss (matches lib/ws.ts scheme mapping)
const GEMINI = "https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com";
// Google Identity Services (GIS): the gsi/client script, the button/One-Tap iframe, and its XHRs all
// live on accounts.google.com. Required so "使用 Google 登入" works (default CSP would block it).
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
  `connect-src 'self' ${API_BASE} ${WS_BASE} ${GEMINI} ${GSI_ORIGIN}`,
  `frame-src 'self' ${GSI_ORIGIN}`,
  `child-src 'self' ${GSI_ORIGIN}`,
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // /train needs the mic; nothing needs camera/geolocation.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Self-contained server output for Docker: emits .next/standalone/<...>/apps/web/server.js.
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // "@meetcopilot/shared" is a workspace TS-source package; Next must transpile it (not treat it as a prebuilt node_modules dep).
  transpilePackages: ["@meetcopilot/shared"],
  webpack: (config) => {
    // shared/src uses NodeNext `.js` extensions in its re-exports (export * from "./crm-types.js").
    // Next resolves @meetcopilot/shared to src/index.ts (via tsconfig paths, since dist/ is absent),
    // so webpack must map those `.js` specifiers onto the real `.ts` sources. Only bites once the web
    // app imports a RUNTIME value from shared (e.g. isTrusted); type-only imports are erased.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);

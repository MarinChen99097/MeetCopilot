/**
 * Server config — loaded from apps/server/.env (copy root .env.example → apps/server/.env).
 * Keys per ARCHITECTURE_PLAN §1. Design note: validation runs inside `loadConfig()` (called once from
 * src/index.ts bootstrap), NOT at import time — so unit tests can import pure helpers (jwt, providers)
 * without triggering fail-fast / process.exit.
 *
 * Fail-fast policy:
 *  - JWT_SECRET missing or a known placeholder  → console.error + process.exit(1). A weak/absent secret
 *    lets anyone forge a valid JWT, so we refuse to start (v1 lesson: JWT_SECRET fail-fast).
 *  - GEMINI_API_KEY missing → console.warn only; server still boots but AI routes answer 502 (M1+).
 *  - OPENAI_API_KEY missing → console.warn only; image generation (M2, pre-meeting) will 502.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
// src/config.ts → apps/server root is one level up.
const SERVER_ROOT = path.resolve(CURRENT_DIR, "..");

export interface GeminiConfig {
  apiKey: string;
  textModel: string;
  /**
   * Model for structured crawl extraction (research engine). Defaults to the stronger `gemini-3.5-flash`
   * (API_FINDINGS §「升級路」) rather than the general `textModel` (flash-lite): the lite model was verified
   * UNRELIABLE for this task — it either mangled JSON / ran away into a multi-hundred-KB string, or
   * hallucinated. `gemini-3.5-flash` extracts rich, faithful CRM fields (incl. zh-TW) and stays stable.
   */
  extractModel: string;
  embedModel: string;
  liveModel: string;
}

export interface OpenAiImageConfig {
  apiKey: string;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
}

export interface AppConfig {
  port: number;
  jwtSecret: string;
  dbPath: string;
  researchAutoLimitPerMeeting: number;
  /**
   * YouTube Data API v3 key (research social layer, WP1). Optional: empty/undefined ⇒ the YouTube social
   * fetcher is skipped (one job-log warning, NOT a job failure — see SOCIAL_CRAWL_FINDINGS §1). Only ever
   * read here into env; never logged, never persisted. When set, the YouTube platform fetcher runs during deep research.
   */
  youtubeApiKey?: string;
  /**
   * Google Programmable Search (Custom Search JSON API) credentials — key-person photo-hunt v3b fallback.
   * BOTH the API key and the CX (search-engine id) must be set to enable it; missing either ⇒ the CSE image
   * fallback is skipped (one config warning, NOT a failure — website/citation photo paths still run). Only ever
   * read here into env; never logged, never persisted.
   */
  googleCseApiKey?: string;
  googleCseCx?: string;
  /**
   * Google OAuth client id used to verify the audience of Google ID tokens (same client id as EZpage, so the
   * two apps share one Google identity by verified email). Feature flag: when set, POST /api/auth/google is
   * active; when empty, that route returns 501 and only local email/password auth (register/login) is available.
   */
  googleClientId: string;
  /**
   * Platform-admin allowlist (ADMIN_CONTRACT §1). Comma-separated emails; a login/register/google whose
   * verified email ∈ this set gets `platformAdmin:true` in its JWT. Empty ⇒ no platform admins (admin app
   * unusable, which is the safe default until an operator sets it). Compared lowercased+trimmed.
   */
  platformAdminEmails: string[];
  /**
   * Extra CORS origin for the admin front-end (ADMIN_CONTRACT §6.1). Added to the allowlist alongside
   * WEB_ORIGIN and the dev defaults (localhost:3000 / :3100). Empty ⇒ not added.
   */
  adminOrigin: string;
  gemini: GeminiConfig;
  openai: OpenAiImageConfig;
}

/** Values that mean "the operator never set a real secret". */
const PLACEHOLDER_SECRETS = new Set([
  "",
  "change-me-in-production",
  "changeme",
  "your-secret-here",
  "placeholder",
  "secret",
]);

function resolvePath(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.join(SERVER_ROOT, raw);
}

/**
 * Read + validate environment. Call once at startup. Exits the process (code 1) on fatal misconfig.
 */
export function loadConfig(): AppConfig {
  dotenv.config({ path: path.join(SERVER_ROOT, ".env") });

  const jwtSecret = (process.env.JWT_SECRET ?? "").trim();
  if (PLACEHOLDER_SECRETS.has(jwtSecret)) {
    console.error(
      "[config] JWT_SECRET is missing or a placeholder — refusing to start. " +
        "Set a long random JWT_SECRET in apps/server/.env (see root .env.example).",
    );
    process.exit(1);
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!geminiApiKey) {
    console.warn(
      "[config] GEMINI_API_KEY not set — text/analysis/generation/ASR AI routes will return 502.",
    );
  }

  const openaiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!openaiApiKey) {
    console.warn(
      "[config] OPENAI_API_KEY not set — pre-meeting image generation (gpt-image-2) will return 502.",
    );
  }

  const googleClientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  if (!googleClientId) {
    console.warn(
      "[config] GOOGLE_CLIENT_ID not set — Google Sign-In disabled (POST /api/auth/google → 501); " +
        "local email/password auth remains active.",
    );
  }

  const platformAdminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (platformAdminEmails.length === 0) {
    console.warn(
      "[config] PLATFORM_ADMIN_EMAILS not set — no platform admins; the admin console (/api/admin/*) " +
        "will reject every login with 403 until an operator sets this allowlist.",
    );
  }

  const adminOrigin = (process.env.ADMIN_ORIGIN ?? "").trim();

  const youtubeApiKey = (process.env.YOUTUBE_API_KEY ?? "").trim();
  if (!youtubeApiKey) {
    console.warn(
      "[config] YOUTUBE_API_KEY not set — research social layer will SKIP the YouTube platform " +
        "(one warning per job; not a failure). Threads + FB/IG (grounding) still run.",
    );
  }

  const googleCseApiKey = (process.env.GOOGLE_CSE_API_KEY ?? "").trim();
  const googleCseCx = (process.env.GOOGLE_CSE_CX ?? "").trim();
  if (!googleCseApiKey || !googleCseCx) {
    console.warn(
      "[config] GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX not both set — key-person photo hunting will SKIP the " +
        "Google image-search (CSE) fallback (website/citation photo paths still run).",
    );
  }

  return {
    port: Number(process.env.PORT ?? 8787),
    jwtSecret,
    dbPath: resolvePath(process.env.DB_PATH ?? "./data/meetcopilot.db"),
    researchAutoLimitPerMeeting: Number(process.env.RESEARCH_AUTO_LIMIT_PER_MEETING ?? 10),
    youtubeApiKey,
    googleCseApiKey,
    googleCseCx,
    googleClientId,
    platformAdminEmails,
    adminOrigin,
    gemini: {
      apiKey: geminiApiKey,
      textModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-3.1-flash-lite",
      extractModel: process.env.GEMINI_EXTRACT_MODEL ?? "gemini-3.5-flash",
      embedModel: process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001",
      liveModel: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
    },
    openai: {
      apiKey: openaiApiKey,
      imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
      imageSize: process.env.OPENAI_IMAGE_SIZE ?? "1536x864",
      imageQuality: process.env.OPENAI_IMAGE_QUALITY ?? "medium",
    },
  };
}

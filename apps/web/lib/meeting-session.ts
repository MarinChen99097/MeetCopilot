"use client";

import { LOCALES, routing } from "@/i18n/routing";

/**
 * Live-session credentials for the realtime surfaces (/copilot, /hud).
 *
 * A session is created by `POST /api/meetings` → `{ meeting, wsUrl, wsToken }` (API_CONTRACT §5).
 * The three roles (capture/hud/present) live in different browsers/devices, so creds are handed off
 * via the URL (`?meetingId=&wsToken=&wsUrl=`) — e.g. the capture end creates the meeting and the HUD
 * opens a link/QR carrying the same creds. We also stash them in sessionStorage so an in-app launcher
 * on the same device can pass them without a full URL round-trip.
 *
 * NOTE: wsToken is short-lived and role-bound server-side; the `role` is the WS query param, and the
 * server authorizes presenter-only actions from the token's identity (I2). The frontend just carries creds.
 */
export interface MeetingCreds {
  meetingId: string;
  wsToken: string;
  /** REST base to derive the ws(s) origin from; falls back to NEXT_PUBLIC_API_BASE when absent. */
  wsUrl?: string;
}

const KEY = "mc_meeting_creds";

/** Read creds from the URL query first (handoff), then sessionStorage. Returns null if incomplete. */
export function readMeetingCreds(): MeetingCreds | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const meetingId = params.get("meetingId");
  const wsToken = params.get("wsToken");
  const wsUrl = params.get("wsUrl") ?? undefined;
  if (meetingId && wsToken) {
    const creds: MeetingCreds = { meetingId, wsToken, wsUrl };
    saveMeetingCreds(creds);
    return creds;
  }

  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MeetingCreds>;
    if (parsed.meetingId && parsed.wsToken) {
      return { meetingId: parsed.meetingId, wsToken: parsed.wsToken, wsUrl: parsed.wsUrl };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

export function saveMeetingCreds(creds: MeetingCreds): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(creds));
  } catch {
    /* ignore */
  }
}

export function clearMeetingCreds(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Parse creds a user pasted (a full session link, or a bare "meetingId|wsToken" / "meetingId wsToken").
 * Lets the HUD (second device) join without a launcher. Returns null if it can't extract both parts.
 */
export function parsePastedCreds(input: string): MeetingCreds | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Try URL form first.
  try {
    const url = new URL(trimmed);
    const meetingId = url.searchParams.get("meetingId");
    const wsToken = url.searchParams.get("wsToken");
    const wsUrl = url.searchParams.get("wsUrl") ?? undefined;
    if (meetingId && wsToken) return { meetingId, wsToken, wsUrl };
  } catch {
    /* not a URL; fall through */
  }
  // Fallback: "meetingId<sep>wsToken".
  const parts = trimmed.split(/[|\s]+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { meetingId: parts[0], wsToken: parts[1] };
  }
  return null;
}

// ── in-app launcher links (locale-prefixed, absolute) ───────────────
//
// The live surfaces open in standalone tabs / on a second device, so their links must be absolute
// (origin + `/{locale}` prefix, per routing.localePrefix="always") — a bare path can't be pasted into
// another device or copied to a QR. Locale is read from the current pathname's first segment (falls back
// to routing.defaultLocale) so the launched tab keeps the operator's UI language.

/** Current UI locale from the URL's first path segment; falls back to the default when absent/unknown. */
function currentLocale(): string {
  if (typeof window === "undefined") return routing.defaultLocale;
  const seg = window.location.pathname.split("/")[1] ?? "";
  return (LOCALES as readonly string[]).includes(seg) ? seg : routing.defaultLocale;
}

/** Absolute, locale-prefixed in-app URL: `${origin}/{locale}${pathWithQuery}`. */
function absoluteInApp(pathWithQuery: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/${currentLocale()}${pathWithQuery}`;
}

/**
 * Build a /present launch URL for the clean presenter stage (Account A).
 *
 * The query matches how /present reads it — `?deckId=&meetingId=&token=` (PresentStage.tsx / present/page.tsx).
 * NOTE on roles: a meeting has ONE short-lived `wsToken` (createMeeting → CreateMeetingResult.wsToken); the WS
 * *role* is the query param on connect, and /present connects `role="present"` (PresentStage). So the
 * "present-role token" IS this meeting's wsToken carried on the present surface — carry `creds.wsToken` as
 * `token`, never a bare capture/hud handoff. I3 (HUD never leaks) is enforced by the PresentStage import
 * whitelist + server role-slicing (present only ever renders deck_update), not by which token is passed.
 * `wsUrl` is intentionally omitted: PresentStage connects via API_BASE and ignores it.
 */
export function buildPresentUrl(deckId: string, creds: MeetingCreds): string {
  const params = new URLSearchParams({
    deckId,
    meetingId: creds.meetingId,
    token: creds.wsToken,
  });
  return absoluteInApp(`/present?${params.toString()}`);
}

/** Static /present launch (local-only flip): deckId only, no meeting/token. */
export function buildStaticPresentUrl(deckId: string): string {
  return absoluteInApp(`/present?${new URLSearchParams({ deckId }).toString()}`);
}

/**
 * Build a /hud join URL for a second physical device (the presenter's own — I3).
 *
 * The query matches what /hud consumes via readMeetingCreds / parsePastedCreds — `?meetingId=&wsToken=&wsUrl=`
 * (note: `wsToken`, not `token` — /present and /hud use different param names). Opening this link (or scanning
 * its QR) lands on the standalone /hud, which self-reads the creds and connects `role="hud"` to the SAME meeting.
 * `wsUrl` is included when present so the second device derives the right ws origin (HudInner uses it ?? API_BASE).
 */
export function buildHudUrl(creds: MeetingCreds): string {
  const params = new URLSearchParams({
    meetingId: creds.meetingId,
    wsToken: creds.wsToken,
  });
  if (creds.wsUrl) params.set("wsUrl", creds.wsUrl);
  return absoluteInApp(`/hud?${params.toString()}`);
}

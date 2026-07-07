"use client";

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

/**
 * Short-lived WS credential (API_CONTRACT §5/§6). Minted by POST /api/meetings, presented as
 * `/ws?token=<wsToken>&meetingId=&role=`. Signed with the app JWT secret but stamped `typ:'ws'` so a normal
 * Bearer app-JWT can never be replayed as a wsToken (and vice-versa) — verify rejects a wrong `typ`.
 *
 * The token binds the connecting identity (userId/orgId) and the meeting, plus the meeting's presenter id.
 * Presenter authority (I2) is decided at the WS layer by `userId === presenterUserId` alone (a pure identity
 * check — `role` is a self-chosen push-target, not a security boundary), NOT by anything the client sends — so
 * an attacker holding a non-presenter token cannot page_commit or approve suggestions under any role.
 */
import jwt from "jsonwebtoken";

const WS_TOKEN_TTL_SECONDS = 60 * 60 * 2; // 2h — long enough for a meeting, short enough to bound replay

export interface WsTokenClaims {
  meetingId: string;
  orgId: string;
  userId: string;
  /** The meeting's presenter (creator). Presenter-only actions require userId === presenterUserId. */
  presenterUserId: string;
}

interface WsTokenPayload extends WsTokenClaims {
  typ: "ws";
}

export function mintWsToken(secret: string, claims: WsTokenClaims): string {
  const payload: WsTokenPayload = { ...claims, typ: "ws" };
  return jwt.sign(payload, secret, { expiresIn: WS_TOKEN_TTL_SECONDS });
}

/** Verify signature/exp/typ. Throws on any tampering, expiry, wrong type, or missing claim. */
export function verifyWsToken(secret: string, token: string): WsTokenClaims {
  const decoded = jwt.verify(token, secret) as Partial<WsTokenPayload>;
  if (decoded.typ !== "ws") throw new Error("not a ws token");
  if (!decoded.meetingId || !decoded.orgId || !decoded.userId || !decoded.presenterUserId) {
    throw new Error("invalid ws token payload");
  }
  return {
    meetingId: decoded.meetingId,
    orgId: decoded.orgId,
    userId: decoded.userId,
    presenterUserId: decoded.presenterUserId,
  };
}

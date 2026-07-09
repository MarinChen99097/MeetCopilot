import { ApiError } from "./api";

/**
 * Web-side error localisation (P1-4 / P0-1). The server keeps its English `{ error: string }` contract
 * unchanged; here we map the common cases to a translation *leaf* key so the UI can render zh-TW/en.
 * Callers translate via a namespaced translator, e.g. `t(`errors.${authErrorKey(err)}`)`.
 * Unknown errors fall through to a generic message. Ordering matters: more-specific substrings first.
 */

/** login/register errors → leaf key under the `auth.errors` namespace. */
export function authErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "network";
    const msg = (err.body.error ?? "").toLowerCase();
    if (msg.includes("invalid credentials")) return "invalidCredentials";
    if (msg.includes("already registered")) return "emailRegistered";
    if (msg.includes("at least 8")) return "passwordTooShort";
    if (msg.includes("valid email")) return "emailRequired";
    if (msg.includes("required")) return "fieldsRequired";
    if (msg.includes("google")) return "google";
    return "generic";
  }
  return "network";
}

/** invite-accept errors → leaf key under the `org.invite.errors` namespace. */
export function inviteErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "network";
    const msg = (err.body.error ?? "").toLowerCase();
    if (msg.includes("invite not found")) return "notFound";
    if (msg.includes("expired")) return "expired";
    if (msg.includes("already accepted")) return "alreadyAccepted";
    if (msg.includes("does not match")) return "emailMismatch";
    if (msg.includes("already a member")) return "alreadyMember";
    if (msg.includes("token is required")) return "missingToken";
    if (msg.includes("no longer exists")) return "gone";
  }
  return "generic";
}

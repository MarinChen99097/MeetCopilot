/**
 * User provisioning — the single place that creates the (org + user + owner membership) tenant triple.
 *
 * Two flows share it:
 *  - Local password `register` (routes.ts): validates + hashes the password, pre-checks for a duplicate
 *    (409), then calls `createUserWithOrg` for the atomic tx. Behaviour is unchanged from before.
 *  - Google Sign-In (POST /api/auth/google): calls the idempotent `provisionUser({email, displayName})`
 *    — find-or-create by verified Google email, mirroring EZpage's "same email = same identity" model.
 *    First call creates the triple with an UNUSABLE password hash (OAuth users have no local password);
 *    repeat calls for the same email return the existing user + their primary org (no duplicate).
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { CrmCore } from "@meetcopilot/crm";
import type { Role } from "@meetcopilot/crm";

const BCRYPT_ROUNDS = 10;

export interface ProvisionResult {
  userId: string;
  orgId: string;
  orgName: string;
  role: Role;
  email: string;
  displayName: string;
}

/** Personal-org name: the display name if present, else the email's local-part (before the `@`). */
export function personalOrgName(email: string, displayName?: string | null): string {
  const dn = displayName?.trim();
  if (dn) return dn;
  const local = email.split("@")[0]?.trim();
  return local && local.length > 0 ? local : email;
}

/**
 * Atomically create org + user + owner membership (the exact triple `register` used to inline). Caller
 * supplies the password hash — bcrypt(user password) for register, an unusable random hash for OAuth.
 * Returns the ids + the persisted org name. Shared by register and `provisionUser`.
 */
export async function createUserWithOrg(
  core: CrmCore,
  input: { email: string; passwordHash: string; displayName: string; orgName: string },
): Promise<{ userId: string; orgId: string; orgName: string }> {
  return core.db.tx(async () => {
    const org = await core.orgs.create({ name: input.orgName });
    const user = await core.users.create({
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
    });
    await core.memberships.addMembership(org.id, user.id, "owner");
    return { userId: user.id, orgId: org.id, orgName: org.name };
  });
}

/** A bcrypt hash of random bytes that no supplied password can ever match (OAuth accounts have no local password). */
async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("hex"), BCRYPT_ROUNDS);
}

async function existingResult(core: CrmCore, user: { id: string; email: string; displayName: string }): Promise<ProvisionResult> {
  const membership = await core.memberships.findPrimaryOrgOf(user.id);
  if (!membership) throw new Error("user has no organization membership");
  const org = await core.orgs.findById(membership.orgId);
  if (!org) throw new Error("organization not found");
  return {
    userId: user.id,
    orgId: org.id,
    orgName: org.name,
    role: membership.role,
    email: user.email,
    displayName: user.displayName,
  };
}

/**
 * Idempotent find-or-create local user by email (used by Google Sign-In). The email is the shared key
 * across MeetCopilot and EZpage; MeetCopilot provisions its own tenant (user + personal org + owner) the
 * first time it sees a verified email, and reuses it thereafter. Handles the unique-email race (concurrent
 * first sign-in) by re-finding on a UNIQUE violation. Never creates a duplicate org for the same email.
 */
export async function provisionUser(
  core: CrmCore,
  input: { email: string; displayName?: string | null },
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName?.trim() || email.split("@")[0]?.trim() || email;

  const existing = await core.users.findByEmail(email);
  if (existing) return existingResult(core, existing);

  try {
    const created = await createUserWithOrg(core, {
      email,
      passwordHash: await unusablePasswordHash(),
      displayName,
      orgName: personalOrgName(email, displayName),
    });
    return { ...created, role: "owner", email, displayName };
  } catch (err) {
    // Concurrent first sign-in for the same email → UNIQUE(email) violation: re-find and reuse.
    if (String((err as Error)?.message ?? "").toUpperCase().includes("UNIQUE")) {
      const race = await core.users.findByEmail(email);
      if (race) return existingResult(core, race);
    }
    throw err;
  }
}

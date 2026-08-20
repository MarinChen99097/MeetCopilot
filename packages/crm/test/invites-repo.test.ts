/**
 * M5 §D 邀請制成員管理驗收（vitest, in-memory DB）：
 *  (a) invite → accept → member 全鏈路（create/findByToken/accept + membership 出現在 members.list）；
 *  (b) last-owner 守則：降級/移除唯一 owner → LastOwnerError；有第二 owner 時放行；
 *  (c) 跨 org 隔離（攻擊者式）：orgA 的 invite/member 不經 orgB scope 外洩；
 *  (d) 找不到成員 → MemberNotFoundError。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore, rejectionName } from "../src/test-helpers.js";
import type { CrmCore } from "../src/ports.js";

// 錯誤型別一律用 `rejectionName(...)` + `toBe("XxxError")` 斷言，不用 `rejects.toBeInstanceOf(...)`：
// 後者在 Windows 上會因為 vitest 偶發的模組重複求值而隨機判偽（理由詳見 test-helpers.ts 的 rejectionName）。
// 判別力不變——name 由各 error class 的 constructor 寫死且唯一。

let core: CrmCore;

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
});
afterEach(() => core.close());

async function seedUser(email: string, name = email) {
  return core.users.create({ email, passwordHash: "h", displayName: name });
}

describe("invite → accept → member", () => {
  it("creates a membership from a valid invite and marks it accepted", async () => {
    const org = await core.orgs.create({ name: "Acme" });
    const owner = await seedUser("owner@acme.com", "Owner");
    await core.memberships.addMembership(org.id, owner.id, "owner");
    const invitee = await seedUser("new@acme.com", "New Hire");

    const invite = await core.invites.create(org.id, {
      email: "new@acme.com",
      role: "member",
      invitedBy: owner.id,
    });
    expect(invite.token).toBeTruthy();
    expect(invite.acceptedAt).toBeUndefined();

    // service-shaped accept: resolve globally by token, then join + mark accepted in one tx.
    const found = await core.invites.findByToken(invite.token);
    expect(found?.orgId).toBe(org.id);
    await core.db.tx(async () => {
      await core.memberships.addMembership(found!.orgId, invitee.id, found!.role);
      await core.invites.accept(found!.orgId, found!.id, Date.now());
    });

    const members = await core.members.list(org.id);
    const emails = members.map((m) => m.email).sort();
    expect(emails).toEqual(["new@acme.com", "owner@acme.com"]);
    expect(members.find((m) => m.email === "new@acme.com")?.role).toBe("member");

    const invites = await core.invites.list(org.id);
    expect(invites[0]?.acceptedAt).toBeGreaterThan(0);
  });

  it("delete revokes an invite", async () => {
    const org = await core.orgs.create({ name: "Acme" });
    const inv = await core.invites.create(org.id, { email: "x@acme.com", role: "admin" });
    await core.invites.delete(org.id, inv.id);
    expect(await core.invites.list(org.id)).toHaveLength(0);
    expect(await core.invites.findByToken(inv.token)).toBeNull();
  });
});

describe("last-owner guard", () => {
  it("refuses to demote the only owner", async () => {
    const org = await core.orgs.create({ name: "Solo" });
    const owner = await seedUser("solo@x.com");
    await core.memberships.addMembership(org.id, owner.id, "owner");
    expect(await rejectionName(core.members.updateRole(org.id, owner.id, "member"))).toBe("LastOwnerError");
    // role unchanged after the refused demotion
    expect(await core.memberships.roleOf(org.id, owner.id)).toBe("owner");
  });

  it("refuses to remove the only owner", async () => {
    const org = await core.orgs.create({ name: "Solo" });
    const owner = await seedUser("solo@x.com");
    await core.memberships.addMembership(org.id, owner.id, "owner");
    expect(await rejectionName(core.members.remove(org.id, owner.id))).toBe("LastOwnerError");
    expect(await core.memberships.roleOf(org.id, owner.id)).toBe("owner");
  });

  it("allows demoting/removing an owner when another owner remains", async () => {
    const org = await core.orgs.create({ name: "Duo" });
    const o1 = await seedUser("o1@x.com");
    const o2 = await seedUser("o2@x.com");
    await core.memberships.addMembership(org.id, o1.id, "owner");
    await core.memberships.addMembership(org.id, o2.id, "owner");

    await core.members.updateRole(org.id, o1.id, "member");
    expect(await core.memberships.roleOf(org.id, o1.id)).toBe("member");
    // o2 is now the only owner → removing it must be refused
    expect(await rejectionName(core.members.remove(org.id, o2.id))).toBe("LastOwnerError");
  });

  it("throws MemberNotFoundError for an unknown member", async () => {
    const org = await core.orgs.create({ name: "Acme" });
    expect(await rejectionName(core.members.updateRole(org.id, "ghost", "member"))).toBe("MemberNotFoundError");
    expect(await rejectionName(core.members.remove(org.id, "ghost"))).toBe("MemberNotFoundError");
  });
});

describe("cross-org isolation (attacker assertions)", () => {
  it("does not leak orgA invites/members through orgB scope", async () => {
    const orgA = await core.orgs.create({ name: "A" });
    const orgB = await core.orgs.create({ name: "B" });
    const a = await seedUser("a@a.com");
    await core.memberships.addMembership(orgA.id, a.id, "owner");
    const invA = await core.invites.create(orgA.id, { email: "hire@a.com", role: "member" });

    // orgB sees none of orgA's invites/members
    expect(await core.invites.list(orgB.id)).toHaveLength(0);
    expect(await core.members.list(orgB.id)).toHaveLength(0);

    // orgB cannot accept/delete orgA's invite via its own scope (no-op, invite stays pending in orgA)
    await core.invites.accept(orgB.id, invA.id, Date.now());
    await core.invites.delete(orgB.id, invA.id);
    const stillThere = await core.invites.list(orgA.id);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]?.acceptedAt).toBeUndefined();

    // orgB cannot mutate orgA's owner membership
    expect(await rejectionName(core.members.remove(orgB.id, a.id))).toBe("MemberNotFoundError");
  });
});

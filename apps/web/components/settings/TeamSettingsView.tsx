"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Invite, InviteRole, MembershipRole, OrgMember } from "@meetcopilot/shared";
import {
  ApiError,
  createOrgInvite,
  listOrgInvites,
  listOrgMembers,
  removeOrgMember,
  revokeOrgInvite,
  updateOrgMemberRole,
} from "@/lib/api";
import { fmtDate, fmtRelative } from "@/lib/format";
import { useMe } from "@/components/auth/AuthGuard";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { Spinner } from "@/components/ui/Spinner";

const ROLE_LABEL: Record<string, string> = { owner: "擁有者", admin: "管理員", member: "成員" };
const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "member", label: "成員" },
  { value: "admin", label: "管理員" },
];

/**
 * /settings/team — 邀請制成員管理（M5 §D）。owner/admin 才可見與操作；member 顯示無權限。
 * 成員清單＋角色、發邀請（顯示 acceptUrl 供複製）、撤銷/移除、改角色。last-owner 由後端守（409 → toast）。
 */
export function TeamSettingsView() {
  const me = useMe();
  const toast = useToast();
  const isManager = me?.role === "owner" || me?.role === "admin";
  const isOwner = me?.role === "owner";

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([listOrgMembers(), listOrgInvites()])
      .then(([m, i]) => {
        if (!alive) return;
        setMembers(m);
        setInvites(i);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "載入失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (isManager) return load();
  }, [isManager, load]);

  if (!isManager) {
    return (
      <main className="mc-crm">
        <div className="mc-crm__header">
          <div>
            <h1 className="mc-crm__h1">團隊成員</h1>
            <p className="mc-crm__lead">只有擁有者或管理員能管理團隊成員與邀請。</p>
          </div>
        </div>
        <div className="mc-errorstate" role="alert">
          <p className="mc-errorstate__msg">你的角色（{ROLE_LABEL[me?.role ?? ""] ?? "成員"}）沒有管理權限。</p>
        </div>
      </main>
    );
  }

  const pendingInvites = invites.filter((i) => !i.acceptedAt);

  async function onChangeRole(userId: string, role: MembershipRole) {
    try {
      await updateOrgMemberRole(userId, role);
      toast.push({ kind: "success", message: "已更新成員角色" });
      load();
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "更新失敗" });
    }
  }

  async function onRemoveMember(m: OrgMember) {
    if (!window.confirm(`確定要將 ${m.displayName} 移出組織嗎？`)) return;
    try {
      await removeOrgMember(m.userId);
      toast.push({ kind: "success", message: "已移除成員" });
      load();
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "移除失敗" });
    }
  }

  async function onRevokeInvite(id: string) {
    try {
      await revokeOrgInvite(id);
      toast.push({ kind: "success", message: "已撤銷邀請" });
      load();
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "撤銷失敗" });
    }
  }

  return (
    <main className="mc-crm">
      <div className="mc-crm__header">
        <div>
          <h1 className="mc-crm__h1">團隊成員</h1>
          <p className="mc-crm__lead">邀請同事加入組織、指派角色。邀請採連結制，複製連結給對方即可加入。</p>
        </div>
      </div>

      <InviteForm
        canAssignAdmin={isOwner}
        onCreated={(url) => {
          toast.push({ kind: "success", message: "已建立邀請，複製連結給對方" });
          load();
          return url;
        }}
        onError={(m) => toast.push({ kind: "error", message: m })}
      />

      <StateBoundary loading={loading} error={error} onRetry={load} isEmpty={false}>
        {/* 成員 */}
        <section className="mc-teamsec">
          <h2 className="mc-teamsec__h2">成員（{members.length}）</h2>
          <ul className="mc-memberlist">
            {members.map((m) => {
              const isSelf = m.userId === me?.user.id;
              const canTouchOwner = isOwner;
              const roleLocked = m.role === "owner" && !canTouchOwner;
              return (
                <li key={m.userId} className="mc-memberrow">
                  <div className="mc-memberrow__id">
                    <span className="mc-logo" aria-hidden="true">
                      {initials(m.displayName)}
                    </span>
                    <div>
                      <span className="mc-memberrow__name">
                        {m.displayName}
                        {isSelf ? <span className="mc-tag">你</span> : null}
                      </span>
                      <span className="mc-memberrow__meta">
                        {m.email} · 加入於 {fmtDate(m.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="mc-memberrow__actions">
                    <select
                      className="mc-input mc-input--sm"
                      value={m.role}
                      disabled={roleLocked}
                      aria-label={`${m.displayName} 的角色`}
                      onChange={(e) => onChangeRole(m.userId, e.target.value as MembershipRole)}
                    >
                      {(isOwner ? (["owner", "admin", "member"] as const) : (["admin", "member"] as const)).map(
                        (r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ),
                      )}
                      {/* 若成員目前為 owner 而你非 owner，仍要能顯示其現值 */}
                      {roleLocked ? <option value="owner">{ROLE_LABEL.owner}</option> : null}
                    </select>
                    <button
                      type="button"
                      className="mc-btn mc-btn--ghost mc-btn--sm"
                      disabled={m.role === "owner" && !isOwner}
                      onClick={() => onRemoveMember(m)}
                    >
                      移除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 待接受邀請 */}
        <section className="mc-teamsec">
          <h2 className="mc-teamsec__h2">待接受邀請（{pendingInvites.length}）</h2>
          {pendingInvites.length === 0 ? (
            <p className="mc-teamsec__empty">目前沒有待接受的邀請。</p>
          ) : (
            <ul className="mc-invitelist">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="mc-inviterow">
                  <div>
                    <span className="mc-inviterow__email">{inv.email}</span>
                    <span className="mc-inviterow__meta">
                      {ROLE_LABEL[inv.role]} · 邀請於 {fmtRelative(inv.createdAt)}
                      {inv.expiresAt ? ` · 逾期 ${fmtDate(inv.expiresAt)}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mc-btn mc-btn--ghost mc-btn--sm"
                    onClick={() => onRevokeInvite(inv.id)}
                  >
                    撤銷
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </StateBoundary>
    </main>
  );
}

function InviteForm({
  canAssignAdmin,
  onCreated,
  onError,
}: {
  canAssignAdmin: boolean;
  onCreated: (url: string) => string;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const roleOptions = canAssignAdmin ? INVITE_ROLE_OPTIONS : INVITE_ROLE_OPTIONS.filter((o) => o.value === "member");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCopied(false);
    try {
      const res = await createOrgInvite({ email: email.trim().toLowerCase(), role });
      setLastUrl(res.acceptUrl);
      onCreated(res.acceptUrl);
      setEmail("");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "建立邀請失敗");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!lastUrl) return;
    try {
      await navigator.clipboard.writeText(lastUrl);
      setCopied(true);
    } catch {
      onError("無法複製，請手動選取連結");
    }
  }

  return (
    <form className="mc-newco" onSubmit={submit}>
      <div className="mc-newco__row">
        <label className="mc-field mc-field--grow">
          <span>受邀者 Email *</span>
          <input
            className="mc-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="colleague@example.com"
          />
        </label>
        <label className="mc-field">
          <span>角色</span>
          <select className="mc-input" value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mc-newco__actions">
          <button type="submit" className="mc-btn mc-btn--primary mc-btn--sm" disabled={busy || !email.trim()}>
            {busy ? <Spinner size={14} /> : "建立邀請"}
          </button>
        </div>
      </div>

      {lastUrl ? (
        <div className="mc-invitelink">
          <span className="mc-invitelink__label">邀請連結（複製給對方）</span>
          <div className="mc-invitelink__row">
            <input className="mc-input mc-invitelink__url" value={lastUrl} readOnly onFocus={(e) => e.target.select()} />
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={copyUrl}>
              {copied ? "已複製 ✓" : "複製"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

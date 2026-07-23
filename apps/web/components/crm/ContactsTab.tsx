"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Contact, ContactSummary, DecisionPower, Seniority } from "@meetcopilot/shared";
import { ApiError, createContact, getContact, listContacts, updateContact } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { VerifiedBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import { PersonaCard, SENIORITY_LABEL } from "./PersonaCard";
import { useEntityProvenance } from "./useProvenance";

const DP_SHORT: Record<DecisionPower, string> = {
  economic_buyer: "決策者",
  champion: "擁護者",
  influencer: "影響者",
  gatekeeper: "守門人",
  user: "使用者",
  blocker: "阻擋者",
  unknown: "未知",
};

/** 人物 tab：主管清單 → 點開 persona 卡。 */
export function ContactsTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [items, setItems] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listContacts(companyId)
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
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
  }, [companyId]);

  useEffect(() => load(), [load]);

  return (
    <div className="mc-tabpane">
      <div className="mc-tabpane__bar">
        <h3 className="mc-tabpane__title">主管 / 人物</h3>
        <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setAdding((a) => !a)}>
          ＋ 新增人物
        </button>
      </div>

      {adding ? (
        <AddContactForm
          companyId={companyId}
          onDone={() => {
            setAdding(false);
            toast.push({ kind: "success", message: "已新增人物" });
            load();
          }}
          onError={(m) => toast.push({ kind: "error", message: m })}
        />
      ) : null}

      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無主管資料"
        emptyHint="用研究引擎補齊，或手動新增人物。"
      >
        <ul className="mc-contactlist">
          {items.map((c) => {
            // 顯示以中文名為主（fullNameZh ?? fullName）；有中文名時原拼音名以次行小字保留。
            const displayName = c.fullNameZh ?? c.fullName;
            const showRomanized = !!c.fullNameZh && !!c.fullName && c.fullName !== c.fullNameZh;
            return (
            <li key={c.id}>
              <button
                type="button"
                className={`mc-contactrow ${selected === c.id ? "is-open" : ""}`}
                onClick={() => setSelected(selected === c.id ? null : c.id)}
                aria-expanded={selected === c.id}
              >
                <span className="mc-contactrow__avatar" aria-hidden="true">
                  {c.photoUrl ? (
                    <img src={c.photoUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    displayName.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span className="mc-contactrow__id">
                  <span className="mc-contactrow__name">{displayName}</span>
                  {showRomanized ? <span className="mc-contactrow__aka">{c.fullName}</span> : null}
                  <span className="mc-contactrow__title">{c.titleZh ?? c.title ?? "未知職稱"}</span>
                </span>
                <span className="mc-contactrow__badges">
                  {c.decisionPower ? <span className="mc-badge mc-badge--info">{DP_SHORT[c.decisionPower]}</span> : null}
                  <VerifiedBadge status={c.verifiedStatus} />
                </span>
              </button>
              {selected === c.id ? <ContactPersona contactId={c.id} onChanged={load} /> : null}
            </li>
            );
          })}
        </ul>
      </StateBoundary>
    </div>
  );
}

function ContactPersona({ contactId, onChanged }: { contactId: string; onChanged: () => void }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getContact(contactId)
      .then((c) => {
        if (!alive) return;
        setContact(c);
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
  }, [contactId]);

  useEffect(() => load(), [load]);

  const prov = useEntityProvenance(
    "contact",
    contactId,
    (id, patch) => updateContact(id, patch as Partial<Contact>),
    () => {
      load();
      onChanged();
    },
  );

  return (
    <div className="mc-contact-detail">
      <StateBoundary loading={loading} error={error} onRetry={load}>
        {contact ? (
          <PersonaCard
            contact={contact}
            provMap={prov.provMap}
            confirm={prov.confirm}
            save={prov.save}
            busyConfirm={prov.busyConfirm}
            busySave={prov.busySave}
          />
        ) : null}
      </StateBoundary>
    </div>
  );
}

function AddContactForm({
  companyId,
  onDone,
  onError,
}: {
  companyId: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [seniority, setSeniority] = useState<Seniority | "">("");
  const [decisionPower, setDecisionPower] = useState<DecisionPower | "">("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createContact(companyId, {
        fullName: fullName.trim(),
        title: title.trim() || undefined,
        department: department.trim() || undefined,
        seniority: seniority || undefined,
        decisionPower: decisionPower || undefined,
      });
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "新增失敗");
      setBusy(false);
    }
  }

  return (
    <form className="mc-newco" onSubmit={submit}>
      <div className="mc-newco__row">
        <label className="mc-field mc-field--grow">
          <span>姓名 *</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label className="mc-field mc-field--grow">
          <span>職稱</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <div className="mc-newco__row">
        <label className="mc-field mc-field--grow">
          <span>部門</span>
          <input value={department} onChange={(e) => setDepartment(e.target.value)} />
        </label>
        <label className="mc-field">
          <span>職級</span>
          <select value={seniority} onChange={(e) => setSeniority(e.target.value as Seniority | "")}>
            <option value="">—</option>
            {(Object.keys(SENIORITY_LABEL) as Seniority[]).map((s) => (
              <option key={s} value={s}>
                {SENIORITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="mc-field">
          <span>決策權</span>
          <select value={decisionPower} onChange={(e) => setDecisionPower(e.target.value as DecisionPower | "")}>
            <option value="">—</option>
            {(Object.keys(DP_SHORT) as DecisionPower[])
              .filter((d) => d !== "unknown")
              .map((d) => (
                <option key={d} value={d}>
                  {DP_SHORT[d]}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="mc-newco__actions">
        <button type="submit" className="mc-btn mc-btn--primary mc-btn--sm" disabled={busy || !fullName.trim()}>
          {busy ? <Spinner size={14} /> : "新增"}
        </button>
      </div>
    </form>
  );
}

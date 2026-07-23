"use client";

import { useLocale } from "next-intl";
import type { Contact, DecisionPower, FieldProvenance, Seniority } from "@meetcopilot/shared";
import { ProvenanceField } from "./ProvenanceField";

/**
 * PersonaCard — a contact's persona (decision_power / hot_buttons / objections_raised /
 * communication_style). Core identity fields carry ProvenanceBadge + confirm/細填; the persona
 * block is framed as HIGH-TRUST (人驗證/會議衍生) and visually distinct from crawler guesses.
 */
export const SENIORITY_LABEL: Record<Seniority, string> = {
  c_level: "C 級高管",
  vp: "副總",
  director: "總監",
  manager: "經理",
  ic: "個人貢獻者",
  founder: "創辦人",
  board: "董事",
};

const DP_META: Record<DecisionPower, { label: string; level: number; tone: string }> = {
  economic_buyer: { label: "經濟決策者", level: 5, tone: "accent" },
  champion: { label: "擁護者", level: 4, tone: "ok" },
  influencer: { label: "影響者", level: 3, tone: "info" },
  gatekeeper: { label: "守門人", level: 2, tone: "warn" },
  user: { label: "使用者", level: 2, tone: "muted" },
  blocker: { label: "阻擋者", level: 1, tone: "danger" },
  unknown: { label: "未知", level: 0, tone: "muted" },
};

export function PersonaCard({
  contact,
  provMap,
  confirm,
  save,
  busyConfirm,
  busySave,
}: {
  contact: Contact;
  provMap: Record<string, FieldProvenance>;
  confirm: (field: string) => void;
  save: (field: string, value: unknown) => void;
  busyConfirm: Set<string>;
  busySave: Set<string>;
}) {
  const isZh = useLocale() === "zh-TW";
  const dp = contact.decisionPower ? DP_META[contact.decisionPower] : undefined;
  // 顯示以中文名為主（fullNameZh ?? fullName）；有中文名時原拼音名以次行小字保留。
  const displayName = contact.fullNameZh ?? contact.fullName;
  const showRomanized = !!contact.fullNameZh && !!contact.fullName && contact.fullName !== contact.fullNameZh;

  const field = (label: string, fieldName: keyof Contact, editable = true) => (
    <ProvenanceField
      label={label}
      fieldName={fieldName}
      value={renderScalar(contact[fieldName])}
      rawValue={scalarString(contact[fieldName])}
      prov={provMap[fieldName]}
      editable={editable}
      busyConfirm={busyConfirm.has(fieldName)}
      busySave={busySave.has(fieldName)}
      onConfirm={confirm}
      onSave={save}
    />
  );

  return (
    <div className="mc-persona">
      <div className="mc-persona__head">
        <span className="mc-persona__avatar" aria-hidden="true">
          {contact.photoUrl ? (
            <img src={contact.photoUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            initials(displayName)
          )}
        </span>
        <div className="mc-persona__id">
          <span className="mc-persona__name">{displayName}</span>
          {showRomanized ? <span className="mc-persona__aka">{contact.fullName}</span> : null}
          <span className="mc-persona__title">
            {contact.titleZh ?? contact.title ?? "未知職稱"}
            {contact.seniority ? ` · ${SENIORITY_LABEL[contact.seniority]}` : ""}
          </span>
        </div>
        {dp ? (
          <div className={`mc-dp mc-dp--${dp.tone}`} title="採購決策權">
            <span className="mc-dp__label">{dp.label}</span>
            <span className="mc-dp__meter" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className={`mc-dp__pip ${i < dp.level ? "is-on" : ""}`} />
              ))}
            </span>
          </div>
        ) : null}
      </div>

      <div className="mc-persona__fields">
        {field("職稱", "title")}
        {field("部門", "department")}
        {field("Email", "email")}
        {field("電話", "phone")}
        {field("LinkedIn", "linkedinUrl")}
      </div>

      {contact.backgroundSummary ? <p className="mc-persona__bg">{contact.backgroundSummary}</p> : null}
      {isZh && contact.backgroundSummaryZh ? (
        <p className="mc-i18n-sum">
          <span className="mc-i18n-sum__label">🌐 中文背景</span>
          {contact.backgroundSummaryZh}
        </p>
      ) : null}

      <div className="mc-persona__trust">
        <div className="mc-persona__trust-head">
          <span className="mc-persona__trust-tag">人驗證 · 高信任</span>
          <span className="mc-persona__trust-hint">以下為人工/會議衍生欄位，與爬蟲猜測區隔</span>
          <button
            type="button"
            className={`mc-btn mc-btn--sm ${contact.trainingUnlocked ? "mc-btn--ghost" : "mc-btn--primary"} mc-persona__unlock`}
            onClick={() => save("trainingUnlocked", contact.trainingUnlocked ? 0 : 1)}
            disabled={busySave.has("trainingUnlocked")}
            title="手動解鎖/鎖定模擬對練（與欄位驗證脫鉤；解鎖後即可到「模擬訓練」對練此人）"
          >
            {busySave.has("trainingUnlocked") ? "…" : contact.trainingUnlocked ? "🔓 已解鎖對練" : "🔒 解鎖對練"}
          </button>
        </div>
        <ChipBlock title="在意重點（hot buttons）" items={contact.hotButtons} tone="accent" />
        <ChipBlock title="優先目標（priorities）" items={contact.knownPriorities} tone="info" />
        <ChipBlock title="痛點" items={contact.painPoints} tone="warn" />
        <ObjectionBlock contact={contact} />
        {contact.communicationStyle ? (
          <p className="mc-persona__comm">
            <span className="mc-persona__comm-k">溝通風格：</span>
            {contact.communicationStyle}
            {contact.commStyleNotes ? `（${contact.commStyleNotes}）` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChipBlock({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  return (
    <div className="mc-chipblock">
      <div className="mc-chipblock__title">{title}</div>
      {items && items.length > 0 ? (
        <div className="mc-chips">
          {items.map((it, i) => (
            <span key={i} className={`mc-chip mc-chip--${tone}`}>
              {it}
            </span>
          ))}
        </div>
      ) : (
        <span className="mc-chipblock__empty">尚未記錄</span>
      )}
    </div>
  );
}

function ObjectionBlock({ contact }: { contact: Contact }) {
  const items = contact.objectionsRaised ?? [];
  return (
    <div className="mc-chipblock">
      <div className="mc-chipblock__title">已提出的異議（objections）</div>
      {items.length > 0 ? (
        <ul className="mc-objections">
          {items.map((o, i) => (
            <li key={i}>
              <span className="mc-objections__q">{o.objection}</span>
              {o.context ? <span className="mc-objections__ctx">{o.context}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="mc-chipblock__empty">尚未記錄</span>
      )}
    </div>
  );
}

function renderScalar(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.join("、");
  return String(v);
}
function scalarString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

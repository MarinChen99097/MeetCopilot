"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TRAIN_DIFFICULTIES,
  type CompanySummary,
  type NewSyntheticPersona,
  type PersonaFieldDraft,
  type TrainDifficulty,
  type TrainObjective,
} from "@meetcopilot/shared";
import { ApiError, createSyntheticPersona, listCompanies } from "@/lib/api";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { DIFFICULTY_META, FIELD_LABELS } from "./personaMeta";

/** 手動填九欄的順序（鍵＝PersonaFieldDraft＝server persona.ts 的 PERSONA_FIELDS）。 */
const PERSONA_FIELD_KEYS: (keyof PersonaFieldDraft)[] = [
  "communicationStyle",
  "commStyleNotes",
  "personalityNotes",
  "decisionStyle",
  "knownPriorities",
  "goalsKpis",
  "hotButtons",
  "painPoints",
  "objectionsRaised",
];

type PersonaFields = Record<keyof PersonaFieldDraft, string>;
const emptyFields = (): PersonaFields => ({
  communicationStyle: "",
  commStyleNotes: "",
  personalityNotes: "",
  decisionStyle: "",
  knownPriorities: "",
  goalsKpis: "",
  hotButtons: "",
  painPoints: "",
  objectionsRaised: "",
});

type Design = "auto" | "manual";

/**
 * SyntheticPersonaCreator —「AI 虛擬人物」自助建對象（#4）。
 * 選公司 → persona 設定（讓 AI 決定／手動填九欄）→ 選填職稱/情境/難度 → 建立一個 is_synthetic contact
 * （server 以 human provenance 寫 persona＋trainingUnlocked=1）→ onCreated(contactId, {difficulty, objective})
 * 把此處選的難度/情境帶回上層預填啟動列（不自動開始；使用者仍需在啟動列按「開始」才過麥克風/計費確認）。
 */
export function SyntheticPersonaCreator({
  onCreated,
}: {
  onCreated: (contactId: string, opts: { difficulty: TrainDifficulty; objective?: TrainObjective }) => void;
}) {
  const toast = useToast();
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [design, setDesign] = useState<Design>("auto");
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<PersonaFields>(emptyFields);
  const [salesGoal, setSalesGoal] = useState("");
  const [meetingPurpose, setMeetingPurpose] = useState("");
  const [difficulty, setDifficulty] = useState<TrainDifficulty>("neutral");
  const [busy, setBusy] = useState(false);

  const loadCompanies = useCallback(() => {
    setLoadErr(null);
    setCompanies(null);
    listCompanies({ pageSize: 200 })
      .then((res) => setCompanies(res.items))
      .catch((e) => setLoadErr(e instanceof ApiError ? e.message : "載入公司清單失敗"));
  }, []);
  useEffect(loadCompanies, [loadCompanies]);

  const setField = (k: keyof PersonaFieldDraft, v: string) => setFields((prev) => ({ ...prev, [k]: v }));

  const submit = useCallback(() => {
    if (!companyId) {
      toast.push({ kind: "error", message: "請先選擇公司" });
      return;
    }
    setBusy(true);

    const sg = salesGoal.trim();
    const mp = meetingPurpose.trim();
    const objective: TrainObjective | undefined =
      sg || mp ? { salesGoal: sg || undefined, meetingPurpose: mp || undefined } : undefined;

    const body: NewSyntheticPersona = {
      companyId,
      fullName: fullName.trim() || undefined,
      title: title.trim() || undefined,
      difficulty,
      objective,
    };
    if (design === "auto") {
      body.autoDesign = true;
    } else {
      const persona: PersonaFieldDraft = {};
      for (const k of PERSONA_FIELD_KEYS) {
        const v = fields[k].trim();
        if (v) persona[k] = v;
      }
      body.persona = persona;
    }

    createSyntheticPersona(body)
      .then((res) => onCreated(res.contactId, { difficulty, objective }))
      .catch((e) => toast.push({ kind: "error", message: e instanceof ApiError ? e.message : "建立虛擬人物失敗" }))
      .finally(() => setBusy(false));
  }, [companyId, fullName, title, difficulty, design, fields, salesGoal, meetingPurpose, toast, onCreated]);

  return (
    <div className="mc-synth">
      <p className="mc-synth__lead">
        建立一個「AI 虛擬人物」對練對象——依所選公司的脈絡設計一位合理決策者。虛擬人物也會出現在該公司的 CRM
        人物清單（標「虛擬」），可隨時回頭調整。
      </p>

      <StateBoundary
        loading={companies === null && !loadErr}
        error={loadErr}
        isEmpty={companies !== null && companies.length === 0}
        onRetry={loadCompanies}
        emptyTitle="尚無公司資料"
        emptyHint="請先到 CRM 建立公司，才能建立該公司的 AI 虛擬人物。"
      >
        <div className="mc-synth__form">
          <label className="mc-field">
            <span>公司 *</span>
            <select className="mc-input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— 選擇公司 —</option>
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="mc-synth__design">
            <legend>persona 設定</legend>
            <label className={`mc-radio${design === "auto" ? " is-on" : ""}`}>
              <input type="radio" name="synth-design" checked={design === "auto"} onChange={() => setDesign("auto")} />
              <span>讓 AI 決定（依公司脈絡自動設計九欄）</span>
            </label>
            <label className={`mc-radio${design === "manual" ? " is-on" : ""}`}>
              <input
                type="radio"
                name="synth-design"
                checked={design === "manual"}
                onChange={() => setDesign("manual")}
              />
              <span>手動設定九欄</span>
            </label>
          </fieldset>

          <div className="mc-synth__row">
            <label className="mc-field mc-field--grow">
              <span>顯示名（選填）</span>
              <input
                className="mc-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="省略時自動命名（如「虛擬決策者」）"
              />
            </label>
            <label className="mc-field mc-field--grow">
              <span>職稱（選填）</span>
              <input
                className="mc-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：採購副總（省略時 AI 可代設）"
              />
            </label>
          </div>

          {design === "manual" ? (
            <div className="mc-synth__fields">
              {PERSONA_FIELD_KEYS.map((k) => (
                <label key={k} className="mc-field">
                  <span>{FIELD_LABELS[k]}</span>
                  <textarea
                    className="mc-input mc-synth__ta"
                    rows={2}
                    value={fields[k]}
                    onChange={(e) => setField(k, e.target.value)}
                    placeholder="選填"
                  />
                </label>
              ))}
            </div>
          ) : null}

          <div className="mc-synth__row">
            <label className="mc-field mc-field--grow">
              <span>本次目標（選填）</span>
              <input
                className="mc-input"
                value={salesGoal}
                onChange={(e) => setSalesGoal(e.target.value)}
                placeholder="例：讓對方同意下一步／釐清關鍵疑慮"
              />
            </label>
            <label className="mc-field mc-field--grow">
              <span>面談目的（選填）</span>
              <input
                className="mc-input"
                value={meetingPurpose}
                onChange={(e) => setMeetingPurpose(e.target.value)}
                placeholder="例：釐清預算與決策流程"
              />
            </label>
          </div>

          <fieldset className="mc-difficulty" aria-label="難度">
            <legend>難度</legend>
            {TRAIN_DIFFICULTIES.map((d) => {
              const meta = DIFFICULTY_META[d];
              return (
                <label key={d} className={`mc-difficulty__opt${difficulty === d ? " is-on" : ""}`}>
                  <input
                    type="radio"
                    name="synth-difficulty"
                    value={d}
                    checked={difficulty === d}
                    onChange={() => setDifficulty(d)}
                  />
                  <span className={`mc-difficulty__label mc-difficulty__label--${meta.tone}`}>{meta.label}</span>
                  <small>{meta.hint}</small>
                </label>
              );
            })}
          </fieldset>

          <div className="mc-synth__actions">
            <button
              type="button"
              className="mc-btn mc-btn--primary"
              disabled={busy || !companyId}
              onClick={submit}
            >
              {busy ? (
                <>
                  <Spinner size={14} /> 建立中…
                </>
              ) : (
                "建立並選取對象"
              )}
            </button>
          </div>
        </div>
      </StateBoundary>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TRAIN_DIFFICULTIES,
  type PersonaOption,
  type TrainDifficulty,
  type TrainObjective,
} from "@meetcopilot/shared";
import { ApiError, draftPersona, listPersonas } from "@/lib/api";
import { Link } from "@/i18n/navigation";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { SyntheticPersonaCreator } from "./SyntheticPersonaCreator";
import { DIFFICULTY_META, FIELD_LABELS } from "./personaMeta";

// Re-export so既有 import 路徑（若有）不破；定義本體已抽到 personaMeta 以避免與 SyntheticPersonaCreator 互 import 成環。
export { DIFFICULTY_META, FIELD_LABELS };

/**
 * 可對練判定（關鍵）：`unlocked || (missing===0 && verifiedFields>0)`。
 * server 的 canTrain 閘用 verified 欄位數 OR trainingUnlocked 放行，因此純看 verifiedFields 會把
 * 「AI 補齊（未驗證草稿）／手動解鎖／虛擬人物」誤判成鎖住——必須把 unlocked 納入。
 */
export function isReady(p: PersonaOption): boolean {
  return p.unlocked || (p.readiness.missing.length === 0 && p.readiness.verifiedFields > 0);
}

type PickerMode = "real" | "synthetic";

/**
 * PersonaPicker — 語音對練的對象挑選。
 * 頂部可切「真人 ／ AI 虛擬人物」：真人列 CRM 主管（未 ready 者可一鍵「讓 AI 補齊」直接可練）；
 * 虛擬人物走 SyntheticPersonaCreator 自助建對象。啟動列可填本次對練情境目的（objective）。
 */
export function PersonaPicker({
  onStart,
  starting,
}: {
  onStart: (persona: PersonaOption, difficulty: TrainDifficulty, objective?: TrainObjective) => void;
  starting: boolean;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<PickerMode>("real");
  const [personas, setPersonas] = useState<PersonaOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<TrainDifficulty>("neutral");
  const [draftingId, setDraftingId] = useState<string | null>(null);
  // 本次對練情境（選填）——開始時併入 startSession 的 objective，注入 persona prompt。
  const [salesGoal, setSalesGoal] = useState("");
  const [meetingPurpose, setMeetingPurpose] = useState("");
  // Pre-start confirmation: pressing 開始語音對練 opens this dialog first (mic + billing + how-to-end),
  // so we never silently trigger a getUserMedia prompt + a billed Gemini Live session on one click.
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setPersonas(null);
    listPersonas()
      .then(setPersonas)
      .catch((e) => setError(e instanceof ApiError ? e.message : "載入失敗"));
  }, []);

  useEffect(load, [load]);

  // #1 讓 AI 補齊真人 persona → 寫未驗證草稿＋解鎖對練 → refetch（該卡變「可對練」）。
  const onDraft = useCallback(
    (contactId: string) => {
      setDraftingId(contactId);
      draftPersona(contactId)
        .then(() => {
          toast.push({ kind: "success", message: "已用 AI 補齊，可開始對練" });
          load();
        })
        .catch((e) => toast.push({ kind: "error", message: e instanceof ApiError ? e.message : "AI 補齊失敗" }))
        .finally(() => setDraftingId(null));
    },
    [toast, load],
  );

  // #4 虛擬人物建立成功 → 切回真人清單、選取該虛擬 persona（unlocked=true 故 isReady）、refetch 拉進清單，
  // 並把 creator 選的難度/情境預填進啟動列（不自動開始／不自動彈 ConfirmDialog——維持「按開始才過麥克風/計費」設計）。
  const onCreated = useCallback(
    (contactId: string, opts: { difficulty: TrainDifficulty; objective?: TrainObjective }) => {
      setMode("real");
      setSelectedId(contactId);
      setDifficulty(opts.difficulty ?? "neutral");
      if (opts.objective) {
        setSalesGoal(opts.objective.salesGoal ?? "");
        setMeetingPurpose(opts.objective.meetingPurpose ?? "");
      }
      load();
      toast.push({ kind: "success", message: "已建立虛擬人物，可開始對練" });
    },
    [load, toast],
  );

  const selected = personas?.find((p) => p.contactId === selectedId) ?? null;
  const canStart = selected !== null && isReady(selected) && !starting;

  function buildObjective(): TrainObjective | undefined {
    const sg = salesGoal.trim();
    const mp = meetingPurpose.trim();
    if (!sg && !mp) return undefined;
    return { salesGoal: sg || undefined, meetingPurpose: mp || undefined };
  }

  return (
    <section className="mc-train">
      <header className="mc-train__intro">
        <h1 className="mc-train__h1">模擬訓練</h1>
        <p className="mc-train__lead">
          用 CRM 裡真實主管的 persona 做語音對練——可打斷、低延遲。缺資料可讓 AI 一鍵補齊，或直接建立 AI 虛擬人物練習。
        </p>
      </header>

      <div className="mc-train__modes" role="group" aria-label="對練對象來源">
        <button
          type="button"
          aria-pressed={mode === "real"}
          className={`mc-seg__btn${mode === "real" ? " is-on" : ""}`}
          onClick={() => setMode("real")}
        >
          真人
        </button>
        <button
          type="button"
          aria-pressed={mode === "synthetic"}
          className={`mc-seg__btn${mode === "synthetic" ? " is-on" : ""}`}
          onClick={() => setMode("synthetic")}
        >
          AI 虛擬人物
        </button>
      </div>

      {mode === "synthetic" ? (
        <SyntheticPersonaCreator onCreated={onCreated} />
      ) : (
        <>
          <StateBoundary
            loading={personas === null && !error}
            error={error}
            isEmpty={personas !== null && personas.length === 0}
            onRetry={load}
            emptyTitle="尚無可對練的對象"
            emptyHint="到 CRM 補齊主管的 persona 欄位，或用上方「讓 AI 補齊」／「AI 虛擬人物」自助建對象。"
            emptyAction={
              <Link href="/crm" className="mc-btn mc-btn--primary">
                前往 CRM 補齊
              </Link>
            }
          >
            <ul className="mc-personalist" role="list">
              {(personas ?? []).map((p) => {
                const ready = isReady(p);
                const active = p.contactId === selectedId;
                const displayName = p.fullNameZh ?? p.fullName; // 顯示以中文名為主，對齊 CRM
                const drafting = draftingId === p.contactId;
                return (
                  <li key={p.contactId}>
                    <button
                      type="button"
                      className={`mc-personacard${active ? " is-active" : ""}${ready ? "" : " is-locked"}`}
                      onClick={() => ready && setSelectedId(p.contactId)}
                      aria-pressed={active}
                      aria-disabled={!ready}
                    >
                      <span className="mc-personacard__avatar" aria-hidden="true">
                        {displayName.slice(0, 1)}
                      </span>
                      <span className="mc-personacard__id">
                        <span className="mc-personacard__name">{displayName}</span>
                        <span className="mc-personacard__title">
                          {p.title}
                          {p.companyName ? ` · ${p.companyName}` : ""}
                        </span>
                        <span className="mc-personacard__readiness">
                          {p.readiness.verifiedFields > 0 ? (
                            <span className="mc-badge mc-badge--ok">已驗證 {p.readiness.verifiedFields} 欄</span>
                          ) : null}
                          {ready ? (
                            <span className="mc-badge mc-badge--accent">可對練</span>
                          ) : (
                            <span className="mc-badge mc-badge--warn">
                              缺 {p.readiness.missing.map((m) => FIELD_LABELS[m] ?? m).join("、")}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    {!ready ? (
                      <div className="mc-personacard__actions">
                        <button
                          type="button"
                          className="mc-btn mc-btn--primary mc-btn--sm"
                          onClick={() => onDraft(p.contactId)}
                          disabled={drafting}
                        >
                          {drafting ? (
                            <>
                              <Spinner size={13} /> AI 補齊中…
                            </>
                          ) : (
                            "讓 AI 補齊"
                          )}
                        </button>
                        <Link
                          href={{
                            pathname: `/crm/${p.companyId}`,
                            query: { tab: "contacts", contact: p.contactId },
                          }}
                          className="mc-personacard__fix"
                        >
                          補齊後可對練 →
                        </Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </StateBoundary>

          {personas && personas.length > 0 ? (
            <div className="mc-train__launch" aria-live="polite">
              {selected && isReady(selected) ? (
                <>
                  <div className="mc-train__launch-who">
                    對練對象：<strong>{selected.fullNameZh ?? selected.fullName}</strong>
                    <span className="mc-train__launch-title">{selected.title}</span>
                  </div>
                  <div className="mc-train__objective">
                    <label className="mc-field mc-field--grow">
                      <span>銷售目標（選填）</span>
                      <input
                        className="mc-input"
                        value={salesGoal}
                        onChange={(e) => setSalesGoal(e.target.value)}
                        placeholder="例：讓對方同意進 POC"
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
                            name="difficulty"
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
                  <button
                    type="button"
                    className="mc-btn mc-btn--primary mc-train__start"
                    disabled={!canStart}
                    onClick={() => canStart && setConfirming(true)}
                  >
                    {starting ? "建立對練中…" : "開始語音對練"}
                  </button>
                </>
              ) : (
                <p className="mc-train__launch-hint">從上方選一位「可對練」的對象，即可填情境、設定難度並開始。</p>
              )}
            </div>
          ) : null}
        </>
      )}

      {confirming && selected ? (
        <ConfirmDialog
          dismissOnBackdrop
          title="開始語音對練前"
          message={
            <>
              <ul className="mc-confirm__list">
                <li>會請求並使用你的<strong>麥克風</strong>（瀏覽器會跳出權限視窗）。</li>
                <li>按下後會立即開始一段<strong>即時語音對練</strong>，並可能產生語音服務費用。</li>
                <li>過程中可隨時開口<strong>打斷</strong>對方；想結束時按<strong>「掛斷並查看評分」</strong>即可。</li>
              </ul>
              <p className="mc-confirm__who">
                對練對象：<strong>{selected.fullNameZh ?? selected.fullName}</strong>
              </p>
            </>
          }
          cancelLabel="取消"
          confirmLabel="同意並開始"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onStart(selected, difficulty, buildObjective());
          }}
        />
      ) : null}
    </section>
  );
}

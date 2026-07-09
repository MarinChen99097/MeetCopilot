"use client";

import { useCallback, useEffect, useState } from "react";
import { TRAIN_DIFFICULTIES, type PersonaOption, type TrainDifficulty } from "@meetcopilot/shared";
import { ApiError, listPersonas } from "@/lib/api";
import { Link } from "@/i18n/navigation";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** A persona is practice-ready once it has no missing persona fields (verified gate + complete). */
export function isReady(p: PersonaOption): boolean {
  return p.readiness.missing.length === 0 && p.readiness.verifiedFields > 0;
}

const DIFFICULTY_META: Record<TrainDifficulty, { label: string; hint: string; tone: string }> = {
  friendly: { label: "友善", hint: "配合、給你空間鋪陳", tone: "ok" },
  neutral: { label: "中性", hint: "務實、就事論事", tone: "info" },
  hostile: { label: "敵對", hint: "多疑、頻繁打斷施壓", tone: "danger" },
};

const FIELD_LABELS: Record<string, string> = {
  hotButtons: "在意點",
  objections: "可能異議",
  decisionPower: "決策權",
  seniority: "資歷",
  communicationStyle: "溝通風格",
  title: "職稱",
};

/**
 * PersonaPicker — lists CRM contacts whose persona fields pass the verified gate (GET /api/train/personas).
 * Ready personas can be practiced; incomplete ones show missing-field hints and route back to /crm.
 */
export function PersonaPicker({
  onStart,
  starting,
}: {
  onStart: (persona: PersonaOption, difficulty: TrainDifficulty) => void;
  starting: boolean;
}) {
  const [personas, setPersonas] = useState<PersonaOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<TrainDifficulty>("neutral");
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

  const selected = personas?.find((p) => p.contactId === selectedId) ?? null;
  const canStart = selected !== null && isReady(selected) && !starting;

  return (
    <section className="mc-train">
      <header className="mc-train__intro">
        <h1 className="mc-train__h1">模擬訓練</h1>
        <p className="mc-train__lead">
          用 CRM 裡真實主管的 persona 做語音對練——可打斷、低延遲。只有 persona 欄位已過驗證閘的對象能對練。
        </p>
      </header>

      <StateBoundary
        loading={personas === null && !error}
        error={error}
        isEmpty={personas !== null && personas.length === 0}
        onRetry={load}
        emptyTitle="尚無可對練的 persona"
        emptyHint="到 CRM 把主管的 persona 欄位（在意點／異議／決策權）確認為 verified，即可解鎖對練。"
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
                    {p.fullName.slice(0, 1)}
                  </span>
                  <span className="mc-personacard__id">
                    <span className="mc-personacard__name">{p.fullName}</span>
                    <span className="mc-personacard__title">
                      {p.title}
                      {p.companyName ? ` · ${p.companyName}` : ""}
                    </span>
                    <span className="mc-personacard__readiness">
                      <span className="mc-badge mc-badge--ok">已驗證 {p.readiness.verifiedFields} 欄</span>
                      {p.readiness.missing.length > 0 ? (
                        <span className="mc-badge mc-badge--warn">
                          缺 {p.readiness.missing.map((m) => FIELD_LABELS[m] ?? m).join("、")}
                        </span>
                      ) : (
                        <span className="mc-badge mc-badge--accent">可對練</span>
                      )}
                    </span>
                  </span>
                  {!ready ? (
                    <Link
                      href="/crm"
                      className="mc-personacard__fix"
                      onClick={(e) => e.stopPropagation()}
                    >
                      補齊後可對練 →
                    </Link>
                  ) : null}
                </button>
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
                對練對象：<strong>{selected.fullName}</strong>
                <span className="mc-train__launch-title">{selected.title}</span>
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
            <p className="mc-train__launch-hint">從上方選一位「可對練」的對象，即可設定難度並開始。</p>
          )}
        </div>
      ) : null}

      {personas && personas.length > 0 && (personas.every((p) => !isReady(p))) ? (
        <EmptyState
          title="目前的對象準備度都不足"
          hint="到 CRM 把 persona 欄位確認為 verified 後即可對練。"
          action={
            <Link href="/crm" className="mc-btn mc-btn--accent">
              前往 CRM
            </Link>
          }
        />
      ) : null}

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
                對練對象：<strong>{selected.fullName}</strong>
              </p>
            </>
          }
          cancelLabel="取消"
          confirmLabel="同意並開始"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onStart(selected, difficulty);
          }}
        />
      ) : null}
    </section>
  );
}

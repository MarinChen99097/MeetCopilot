"use client";

import { useState } from "react";
import type { TrainReport, TrainScores, TrainTurn } from "@meetcopilot/shared";
import { StateBoundary } from "@/components/ui/StateBoundary";

const SCORE_META: { key: keyof TrainScores; label: string; hint: string }[] = [
  { key: "objectionHandling", label: "異議處理", hint: "面對質疑的回應力" },
  { key: "discovery", label: "發現需求", hint: "挖掘痛點與動機" },
  { key: "clarity", label: "表達清晰", hint: "訊息精準易懂" },
  { key: "closing", label: "成交推進", hint: "推動下一步" },
];

function scoreTone(v: number): string {
  if (v >= 75) return "ok";
  if (v >= 50) return "warn";
  return "danger";
}

/**
 * ScoreReport — post-session four-dimension scorecard + highlight quote cards + summary.
 * Presentational: parent supplies the report (finish → getTrainReport) plus the locally-captured
 * transcript for review.
 */
export function ScoreReport({
  report,
  loading,
  error,
  onRetry,
  onRestart,
  transcript,
  personaName,
}: {
  report: TrainReport | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRestart: () => void;
  transcript: TrainTurn[];
  personaName: string;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const avg = report
    ? Math.round(
        (report.scores.objectionHandling + report.scores.discovery + report.scores.clarity + report.scores.closing) / 4,
      )
    : 0;

  return (
    <section className="mc-report" aria-label="評分報告">
      <header className="mc-report__head">
        <div>
          <h1 className="mc-report__h1">課後評分</h1>
          <p className="mc-report__sub">與 {personaName} 的對練</p>
        </div>
        <button type="button" className="mc-btn mc-btn--primary" onClick={onRestart}>
          再練一次
        </button>
      </header>

      <StateBoundary
        loading={loading}
        error={error}
        onRetry={onRetry}
        skeleton={
          <div className="mc-report__skel">
            <div className="mc-skel__line" style={{ width: "40%", height: 40 }} />
            <div className="mc-skel__line" style={{ width: "100%" }} />
            <div className="mc-skel__line" style={{ width: "80%" }} />
          </div>
        }
      >
        {report ? (
          <>
            <div className="mc-report__overall">
              <div className={`mc-report__overall-num mc-report__overall-num--${scoreTone(avg)}`}>{avg}</div>
              <div className="mc-report__overall-cap">
                <span>綜合分數</span>
                <small>四維平均（0–100）</small>
              </div>
            </div>

            <div className="mc-scoregrid">
              {SCORE_META.map((m) => {
                const v = report.scores[m.key];
                return (
                  <div key={m.key} className="mc-scorecell">
                    <div className="mc-scorecell__top">
                      <span className="mc-scorecell__label">{m.label}</span>
                      <span className={`mc-scorecell__num mc-scorecell__num--${scoreTone(v)}`}>{v}</span>
                    </div>
                    <div className="mc-scorecell__bar" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={m.label}>
                      <span className={`mc-scorecell__fill mc-scorecell__fill--${scoreTone(v)}`} style={{ width: `${v}%` }} />
                    </div>
                    <small className="mc-scorecell__hint">{m.hint}</small>
                  </div>
                );
              })}
            </div>

            {report.summary ? <p className="mc-report__summary">{report.summary}</p> : null}

            <h2 className="mc-report__h2">重點時刻</h2>
            {report.highlights.length === 0 ? (
              <p className="mc-report__empty">本次沒有特別標記的片段。</p>
            ) : (
              <div className="mc-highlights">
                {report.highlights.map((h, i) => (
                  <figure key={i} className={`mc-highlight mc-highlight--${h.kind}`}>
                    <figcaption className="mc-highlight__tag">{h.kind === "good" ? "做得好" : "可改進"}</figcaption>
                    <blockquote className="mc-highlight__quote">「{h.quote}」</blockquote>
                    <p className="mc-highlight__comment">{h.comment}</p>
                  </figure>
                ))}
              </div>
            )}

            {transcript.length > 0 ? (
              <div className="mc-report__transcript">
                <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setShowTranscript((v) => !v)}>
                  {showTranscript ? "收合逐字稿" : `查看逐字稿（${transcript.length} 句）`}
                </button>
                {showTranscript ? (
                  <div className="mc-transcript" role="log">
                    {transcript.map((t, i) => (
                      <p key={i} className={`mc-caption mc-caption--${t.speaker}`}>
                        <span className="mc-caption__who">{t.speaker === "ai" ? personaName : "你"}</span>
                        <span className="mc-caption__text">{t.text}</span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </StateBoundary>
    </section>
  );
}

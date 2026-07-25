"use client";

import { useState } from "react";
import type { TrainReport, TrainTurn } from "@meetcopilot/shared";
import { StateBoundary } from "@/components/ui/StateBoundary";

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
  // 綜合分數＝各維度平均（維度數依模式而異）；空陣列 → 0。
  const avg =
    report && report.scores.length > 0
      ? Math.round(report.scores.reduce((s, d) => s + d.score, 0) / report.scores.length)
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
                <small>各維度平均（0–100）</small>
              </div>
            </div>

            <div className="mc-scoregrid">
              {report.scores.map((d, i) => {
                const v = d.score;
                return (
                  <div key={`${d.label}-${i}`} className="mc-scorecell">
                    <div className="mc-scorecell__top">
                      <span className="mc-scorecell__label">{d.label}</span>
                      <span className={`mc-scorecell__num mc-scorecell__num--${scoreTone(v)}`}>{v}</span>
                    </div>
                    <div className="mc-scorecell__bar" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={d.label}>
                      <span className={`mc-scorecell__fill mc-scorecell__fill--${scoreTone(v)}`} style={{ width: `${v}%` }} />
                    </div>
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

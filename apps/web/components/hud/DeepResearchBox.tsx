"use client";

import { useState, type FormEvent } from "react";

export interface ResearchLine {
  jobId: string;
  status: string;
}

/**
 * 深查 (deep_research) — free-text query → triggers research, bounded by remainingQuota (disabled at 0).
 * research_status lines show the queued→running→done progress the server streams back.
 */
export function DeepResearchBox({
  remainingQuota,
  lines,
  onSubmit,
}: {
  remainingQuota: number | null;
  lines: ResearchLine[];
  onSubmit: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const exhausted = remainingQuota !== null && remainingQuota <= 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || exhausted) return;
    onSubmit(q);
    setQuery("");
  }

  return (
    <section className="mc-hud__panel mc-hud__research" aria-label="深查">
      <h2 className="mc-hud__panel-title">
        深查
        <span className="mc-hud__quota">
          剩餘配額：{remainingQuota === null ? "—" : remainingQuota}
        </span>
      </h2>
      <form className="mc-hud__researchform" onSubmit={submit}>
        <input
          className="mc-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={exhausted ? "本場配額已用盡" : "輸入要深入研究的主題…"}
          disabled={exhausted}
          aria-label="深查主題"
        />
        <button type="submit" className="mc-btn mc-btn--accent" disabled={exhausted || !query.trim()}>
          深查
        </button>
      </form>
      {exhausted ? <p className="mc-hud__quota-note">本場深查配額已用盡。</p> : null}
      {lines.length ? (
        <ul className="mc-hud__researchlines">
          {lines.map((l) => (
            <li key={l.jobId}>
              <span className="mc-badge mc-badge--info">{l.status}</span>
              <span className="mc-hud__jobid">{l.jobId.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

export interface ResearchLine {
  jobId: string;
  status: string;
}

/**
 * 深查 (deep_research) — 自由文字 → 觸發研究，受 remainingQuota 限制（用盡即 disabled）。
 * research_status 逐條顯示 queued→running→done。
 *
 * 2026-07-30 重設計：從一整塊面板收成**一列**（設計稿把「幫我查一下」放在建議卡旁邊，
 * 但深查需要一個查詢字串，砍掉輸入框等於砍掉功能——故保留輸入框、只把版面壓扁）。
 * 進行中的 job 沿用設計稿「深查進行中列」（spinner ＋ accentSoft 底，原稿 :226-228）。
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
  const t = useTranslations("hud.research");
  const [query, setQuery] = useState("");
  const exhausted = remainingQuota !== null && remainingQuota <= 0;
  const running = lines.filter((l) => l.status === "queued" || l.status === "running");

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || exhausted) return;
    onSubmit(q);
    setQuery("");
  }

  return (
    <section className="mc-dr" aria-label={t("title")}>
      <form className="mc-dr__form" onSubmit={submit}>
        <input
          className="mc-input mc-dr__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={exhausted ? t("exhausted") : t("placeholder")}
          disabled={exhausted}
          aria-label={t("title")}
        />
        <button type="submit" className="mc-btn mc-btn--sm" disabled={exhausted || !query.trim()}>
          {t("submit")}
        </button>
        <span className="mc-dr__quota mc-mono">
          {remainingQuota === null ? "" : t("quota", { n: remainingQuota })}
        </span>
      </form>
      {running.length ? (
        <p className="mc-dr__running" role="status">
          <span className="mc-dr__spinner" aria-hidden="true" />
          {t("running", { n: running.length })}
        </p>
      ) : null}
    </section>
  );
}

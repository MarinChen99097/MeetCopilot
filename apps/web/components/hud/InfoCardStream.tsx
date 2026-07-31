"use client";

import { useTranslations } from "next-intl";
import type { InfoCard, InfoCardKind } from "@meetcopilot/shared";
import { Markdown } from "@/components/ui/Markdown";

/**
 * 情報卡流。2026-07-30 重設計（設計稿 :275-286）：卡片瘦身成
 * `kind（mono）｜來源（mono，靠右）｜標題 14px/600｜內文 12.5px`，信任等級改用 kind 行的顏色表達。
 *
 * 設計稿把情報收進「對方的資料／我們可以說」兩個 tab——分組規則走既有的 `InfoCardKind`
 * （**沒有新增 wire 欄位**）：company / contact / research ＝對方的資料；battlecard / objection_handler ＝我們可以說。
 */
export const INTEL_THEM: readonly InfoCardKind[] = ["company", "contact", "research"];
export const INTEL_US: readonly InfoCardKind[] = ["battlecard", "objection_handler"];

export type IntelTab = "them" | "us";

/** 依 tab 過濾（純函式，供 cockpit 右欄與手機視圖共用）。 */
export function filterIntel(cards: InfoCard[], tab: IntelTab): InfoCard[] {
  const allow = tab === "them" ? INTEL_THEM : INTEL_US;
  return cards.filter((c) => allow.includes(c.kind));
}

const KIND_KEY: Record<InfoCardKind, string> = {
  company: "kindCompany",
  contact: "kindContact",
  battlecard: "kindBattlecard",
  objection_handler: "kindObjection",
  research: "kindResearch",
};

const TRUST_KEY: Record<InfoCard["trust"], string> = {
  verified: "trustVerified",
  crawler: "trustCrawler",
  live: "trustLive",
};

export function InfoCardStream({
  cards,
  variant = "desk",
  emptyLabel,
}: {
  cards: InfoCard[];
  variant?: "desk" | "mobile";
  emptyLabel?: string;
}) {
  const t = useTranslations("hud.intel");

  if (cards.length === 0) {
    return <p className="mc-intel__empty">{emptyLabel ?? t("empty")}</p>;
  }

  return (
    <ul className={`mc-intel mc-intel--${variant}`}>
      {cards.map((c) => (
        <li key={c.id} className={`mc-intel__card mc-intel__card--${c.trust}`}>
          <div className="mc-intel__head">
            <span className="mc-intel__kind mc-mono">{t(KIND_KEY[c.kind])}</span>
            <span className="mc-intel__src mc-mono">
              {t(TRUST_KEY[c.trust])}
              {typeof c.confidence === "number" ? ` · ${(c.confidence * 100) | 0}%` : ""}
            </span>
          </div>
          <p className="mc-intel__title">{c.title}</p>
          <Markdown className="mc-intel__body">{c.body}</Markdown>
          {c.sourceUrl ? (
            <a className="mc-intel__link mc-mono" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
              {t("source")}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

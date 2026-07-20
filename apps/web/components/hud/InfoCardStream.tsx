"use client";

import type { InfoCard } from "@meetcopilot/shared";
import { Markdown } from "@/components/ui/Markdown";

const KIND_LABEL: Record<InfoCard["kind"], string> = {
  company: "公司",
  contact: "主管",
  battlecard: "戰報卡",
  objection_handler: "異議處理",
  research: "研究",
};

const TRUST_LABEL: Record<InfoCard["trust"], string> = {
  verified: "已驗證",
  crawler: "爬蟲",
  live: "即時",
};

/**
 * Info-card stream — 5 kinds, each with a trust badge whose visual tier is explicit:
 * verified (solid green) > crawler (blue outline) > live (pulsing purple). Newest first.
 */
export function InfoCardStream({ cards }: { cards: InfoCard[] }) {
  return (
    <section className="mc-hud__panel" aria-label="情報卡">
      <h2 className="mc-hud__panel-title">情報卡</h2>
      {cards.length === 0 ? (
        <p className="mc-hud__empty">聆聽中，尚無情報卡…</p>
      ) : (
        <ul className="mc-cardstream">
          {cards.map((c) => (
            <li key={c.id} className={`mc-infocard mc-infocard--${c.kind}`}>
              <div className="mc-infocard__head">
                <span className="mc-infocard__kind">{KIND_LABEL[c.kind]}</span>
                <span className={`mc-trust mc-trust--${c.trust}`}>{TRUST_LABEL[c.trust]}</span>
              </div>
              <div className="mc-infocard__title">{c.title}</div>
              <Markdown className="mc-infocard__body">{c.body}</Markdown>
              <div className="mc-infocard__foot">
                {typeof c.confidence === "number" ? (
                  <span className="mc-conf mc-conf--mid">信心 {(c.confidence * 100) | 0}%</span>
                ) : null}
                {c.sourceUrl ? (
                  <a className="mc-infocard__src" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
                    來源 ↗
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

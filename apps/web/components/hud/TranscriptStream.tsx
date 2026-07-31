"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SignalItem, TranscriptSegment } from "@meetcopilot/shared";

/**
 * 即時逐字稿。2026-07-30 重設計（設計稿 :233-247）：升格成 cockpit 中欄主體——
 * 每行是 `58px | 1fr` 兩欄（mono 相對時間 ｜ 說話者＋內文）。自動捲到最新，使用者往上捲時暫停
 * （可以回頭讀）；上方保留最近訊號 chip 條。
 *
 * ⚠ 設計稿的「重要的話會標色」（逐字稿行加 warn 底）**沒有實作**：`SignalItem` 上沒有任何欄位
 * 指回 segment（見 packages/shared/src/signals.ts），前端無從得知哪一行重要。憑 label 猜測＝假資料，
 * 依契約「後端沒有的資料不渲染」一律不畫。要補得先在 wire 上加 segmentId（W4 之後的事）。
 */
export function TranscriptStream({
  segments,
  signals,
  variant = "desk",
}: {
  segments: TranscriptSegment[];
  signals: SignalItem[];
  variant?: "desk" | "mobile";
}) {
  const t = useTranslations("hud.transcript");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!pinned) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, pinned]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setPinned(nearBottom);
  }

  const speakerLabel = (seg: TranscriptSegment) =>
    seg.speakerLabel && seg.speakerLabel.trim()
      ? seg.speakerLabel
      : t(seg.speaker === "presenter" ? "whoPresenter" : seg.speaker === "client" ? "whoClient" : "whoUnknown");

  return (
    <section className={`mc-tx mc-tx--${variant}`} aria-label={t("title")}>
      <div className="mc-tx__head">
        <span className="mc-kicker">{t("title")}</span>
        <span className="mc-tx__dot" aria-hidden="true" />
      </div>

      {signals.length ? (
        <div className="mc-tx__signals" aria-label={t("signals")}>
          {signals.map((s) => (
            <span
              key={s.id}
              className={`mc-sig3 mc-sig3--${s.kind}`}
              title={`${t("confidence")} ${(s.confidence * 100) | 0}%`}
            >
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mc-tx__stream" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite">
        {segments.length === 0 ? (
          <p className="mc-tx__empty">{t("empty")}</p>
        ) : (
          segments.map((seg) => (
            <div key={seg.id} className={`mc-tx__row${seg.final ? "" : " is-interim"}`}>
              <span className="mc-tx__t mc-mono">{formatStamp(seg.t)}</span>
              <p className="mc-tx__text">
                <span className={`mc-tx__who mc-tx__who--${seg.speaker}`}>{speakerLabel(seg)}</span>
                {seg.text}
                {seg.final ? null : (
                  <span className="mc-tx__dots" aria-label={t("listening")}>
                    …
                  </span>
                )}
              </p>
            </div>
          ))
        )}
      </div>

      {!pinned ? (
        <button
          type="button"
          className="mc-tx__jump"
          onClick={() => {
            setPinned(true);
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          {t("jumpLatest")}
        </button>
      ) : null}
    </section>
  );
}

/** ms → `m:ss`（逐字稿時間軸是「這場開始後多久」，不是牆上時鐘）。 */
function formatStamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

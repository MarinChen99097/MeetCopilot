"use client";

import { useEffect, useRef, useState } from "react";
import type { SignalItem, TranscriptSegment } from "@meetcopilot/shared";

const SPEAKER_LABEL: Record<TranscriptSegment["speaker"], string> = {
  presenter: "報告者",
  client: "客戶",
  unknown: "未知",
};

/**
 * Live transcript stream — speaker-tagged bubbles, interim ("正在聽…") vs final styling, auto-scroll
 * to newest that PAUSES when the user scrolls up (so they can read back). A recent-signals strip sits
 * on top so emotion/intent tags are visible alongside the words.
 */
export function TranscriptStream({
  segments,
  signals,
}: {
  segments: TranscriptSegment[];
  signals: SignalItem[];
}) {
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

  return (
    <section className="mc-hud__panel mc-hud__transcript" aria-label="即時逐字稿">
      {signals.length ? (
        <div className="mc-hud__signals" aria-label="會中訊號">
          {signals.map((s) => (
            <span key={s.id} className={`mc-sig mc-sig--${s.kind}`} title={`信心 ${(s.confidence * 100) | 0}%`}>
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mc-hud__stream" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite">
        {segments.length === 0 ? (
          <p className="mc-hud__empty">聆聽中，尚無逐字稿…</p>
        ) : (
          segments.map((seg) => (
            <div key={seg.id} className={`mc-line mc-line--${seg.speaker} ${seg.final ? "" : "is-interim"}`}>
              {/* speakerLabel（選填，§4.2）優先；空/缺席時退回既有 presenter/client 標籤——缺席不壞版面。 */}
              <span className="mc-line__who">
                {seg.speakerLabel && seg.speakerLabel.trim() ? seg.speakerLabel : SPEAKER_LABEL[seg.speaker]}
              </span>
              <span className="mc-line__text">
                {seg.text}
                {seg.final ? null : <span className="mc-line__dots" aria-label="正在聽">…</span>}
              </span>
            </div>
          ))
        )}
      </div>

      {!pinned ? (
        <button
          type="button"
          className="mc-hud__jump"
          onClick={() => {
            setPinned(true);
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          ↓ 跳到最新
        </button>
      ) : null}
    </section>
  );
}

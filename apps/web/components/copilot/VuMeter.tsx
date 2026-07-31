"use client";

import { useEffect, useRef } from "react";

/** 設計稿的 VU 表是 22 根等寬柱（原稿 :175-178），高度隨音量變化、`transition:height .2s`。 */
const BARS = 22;

/**
 * VU meter — 22 根 CSS 柱，由 `getLevel()`（0..1）以 requestAnimationFrame 輪詢驅動。
 * 證明聲音真的在流動（「有聲/靜音」都可 demo）；`active=false` 時畫成靜音（全部貼底）。
 *
 * 2026-07-30 重設計：原本是 canvas，且**把配色寫死成深底**（`#0e1728` 底 + 螢光綠柱），
 * 淺色主題下會出現一塊突兀的深藍——改成 DOM 柱 ＋ `--mc-*` token，雙主題自動正確。
 * 直接改 style.height（不進 React state）避免每幀 re-render；prefers-reduced-motion 時只畫一次靜態圖。
 */
export function VuMeter({ getLevel, active, label }: { getLevel: () => number; active: boolean; label: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const bars = Array.from(wrap.children) as HTMLElement[];
    if (bars.length === 0) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let alive = true;
    // 每根柱各自的保持值：上升即時、回落慢（peak-hold），讀得出「剛剛有人講話」。
    const held = new Array<number>(bars.length).fill(0);
    const mid = (bars.length - 1) / 2;

    const draw = () => {
      if (!alive) return;
      const raw = active ? getLevel() : 0;
      const level = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
      for (let i = 0; i < bars.length; i += 1) {
        const bar = bars[i];
        if (!bar) continue;
        // 中央權重：以中間為峰往兩側衰減（頻譜感）；靜音時全部貼底。
        const center = 1 - Math.abs(i - mid) / mid;
        const target = level * (0.35 + 0.65 * center);
        const prev = held[i] ?? 0;
        const nextH = target > prev ? target : prev * 0.88;
        held[i] = nextH;
        bar.style.height = `${(8 + nextH * 92).toFixed(1)}%`;
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [getLevel, active]);

  return (
    <div
      ref={wrapRef}
      className="mc-vu3"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="mc-vu3__bar" />
      ))}
    </div>
  );
}

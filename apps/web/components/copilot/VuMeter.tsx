"use client";

import { useEffect, useRef } from "react";

/**
 * VU meter — canvas bar driven by a polled level source (0..1). Proves audio is really flowing
 * ("有聲/靜音" both demoable). `getLevel` is polled via requestAnimationFrame; when `active` is
 * false it renders an empty (silent) meter. Respects prefers-reduced-motion by drawing a static bar.
 */
export function VuMeter({ getLevel, active }: { getLevel: () => number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let alive = true;

    const draw = () => {
      if (!alive) return;
      const level = active ? getLevel() : 0;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0e1728";
      ctx.fillRect(0, 0, w, h);

      const bw = level * w;
      ctx.fillStyle = level > 0.85 ? "#f87171" : level > 0.6 ? "#fbbf24" : "#34d399";
      ctx.fillRect(0, 0, bw, h);

      // peak hold
      if (level > peakRef.current) peakRef.current = level;
      else peakRef.current = Math.max(0, peakRef.current * 0.95);
      ctx.fillStyle = "#e6ebf5";
      ctx.fillRect(Math.max(0, peakRef.current * w - 2), 0, 2, h);

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [getLevel, active]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={40}
      className="mc-vu"
      role="meter"
      aria-label="即時音量表"
      aria-valuemin={0}
      aria-valuemax={1}
    />
  );
}

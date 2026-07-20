import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { extractPaletteFromPng, NEUTRAL_LIGHT_THEME } from "./palette.js";

function solidPng(w: number, h: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** 淺背景＋中央一塊飽和色（模擬有品牌主色的商務頁）。 */
function bgWithAccent(w: number, h: number, bg: [number, number, number], accent: [number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const inCenter = x > w * 0.4 && x < w * 0.6 && y > h * 0.4 && y < h * 0.6;
      const c = inCenter ? accent : bg;
      png.data[o] = c[0];
      png.data[o + 1] = c[1];
      png.data[o + 2] = c[2];
      png.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("extractPaletteFromPng", () => {
  it("純淺色頁 → 抽到該淺底（非 fallback）＋深字", () => {
    const t = extractPaletteFromPng(solidPng(64, 64, 240, 236, 230));
    expect(t.text).toBe("#1b2130");
    // bg 為實際取樣色（#f0ece6），刻意不等於中性 fallback 的 #f6f7f9 → 證明是真抽到
    expect(t.bg?.toLowerCase()).toBe("#f0ece6");
  });

  it("純深色頁 → 深底＋淺字", () => {
    const t = extractPaletteFromPng(solidPng(64, 64, 20, 24, 34));
    expect(t.text).toBe("#f4f6fb");
  });

  it("淺底＋中央飽和藍 → 抽到藍色系主色（非中性 fallback）", () => {
    const t = extractPaletteFromPng(bgWithAccent(80, 80, [246, 247, 249], [40, 90, 220]));
    expect(t.text).toBe("#1b2130");
    expect(t.accent).not.toBe(NEUTRAL_LIGHT_THEME.accent);
    const r = parseInt(t.accent!.slice(1, 3), 16);
    const b = parseInt(t.accent!.slice(5, 7), 16);
    expect(b).toBeGreaterThan(r); // 藍為主
  });

  it("純淺底無飽和色 → accent 退中性主色", () => {
    const t = extractPaletteFromPng(solidPng(64, 64, 240, 236, 230));
    expect(t.accent).toBe(NEUTRAL_LIGHT_THEME.accent);
  });

  it("非法 buffer → 整組退中性淺色", () => {
    expect(extractPaletteFromPng(Buffer.from("not-a-png"))).toEqual(NEUTRAL_LIGHT_THEME);
  });
});

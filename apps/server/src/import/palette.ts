/**
 * 匯入頁「抽色」——把一頁點陣圖濃縮成 3 色 SlideTheme（bg/text/accent），讓匯入頁與其衍生的
 * 生成補充頁採用同一色調，消除「深色紫 app 模板 vs 淺色匯入 deck」的風格落差。
 *
 * 使用者拍板策略（2026-07-20）：**抽色為主，抽不到退中性淺色**。故本函式恆回一個主題——
 * 抽色成功回實際配色；任一步失敗或低信心（邊緣非純背景/主色不夠飽和）回 NEUTRAL_LIGHT_THEME。
 *
 * 純 CPU、無外呼；用 pngjs（純 JS，無原生相依）解碼 pdftoppm/soffice 產出的 PNG。
 */
import { PNG } from "pngjs";
import type { SlideTheme } from "@meetcopilot/shared";

/** 抽色失敗/低信心時的中性淺色主題（乾淨淺底＋深字＋收斂靛藍主色，貼近多數商務簡報）。 */
export const NEUTRAL_LIGHT_THEME: SlideTheme = { bg: "#f6f7f9", text: "#1b2130", accent: "#4f6bed" };

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 相對亮度（0–1，Rec.709 係數）。 */
function relLum({ r, g, b }: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function toHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 曼哈頓色距（0–765）。 */
function manhattan(a: RGB, b: RGB): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** HSV 飽和度（0–1）。 */
function saturation({ r, g, b }: RGB): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

function average(cs: RGB[]): RGB {
  const n = cs.length || 1;
  return {
    r: cs.reduce((s, c) => s + c.r, 0) / n,
    g: cs.reduce((s, c) => s + c.g, 0) / n,
    b: cs.reduce((s, c) => s + c.b, 0) / n,
  };
}

/**
 * 從一頁 PNG buffer 抽 SlideTheme。
 * - bg：四角＋四邊中點取樣的平均（商務簡報邊緣多為純背景色）；這些取樣點彼此過於分歧（>閾值）＝
 *   邊緣有內容/漸層 → 低信心 → 退中性淺色。
 * - text：依 bg 亮度給深或淺字（保對比）。
 * - accent：稀疏掃描全圖，排除近黑/近白與貼近背景者，取飽和度最高的像素；不夠飽和則用中性主色。
 */
export function extractPaletteFromPng(buffer: Buffer): SlideTheme {
  try {
    const png = PNG.sync.read(buffer);
    const { width: w, height: h, data } = png;
    if (w < 8 || h < 8) return NEUTRAL_LIGHT_THEME;

    const at = (x: number, y: number): RGB => {
      const i = (y * w + x) * 4;
      return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    };

    const m = 3; // 內縮，跳過抗鋸齒邊框
    const edgePts = [
      at(m, m),
      at(w - 1 - m, m),
      at(m, h - 1 - m),
      at(w - 1 - m, h - 1 - m),
      at(w >> 1, m),
      at(w >> 1, h - 1 - m),
      at(m, h >> 1),
      at(w - 1 - m, h >> 1),
    ];
    const bg = average(edgePts);
    const spread = Math.max(...edgePts.map((c) => manhattan(c, bg)));
    if (spread > 96) return NEUTRAL_LIGHT_THEME; // 邊緣非純背景 → 低信心

    const text = relLum(bg) > 0.5 ? "#1b2130" : "#f4f6fb";

    let best: RGB | null = null;
    let bestSat = 0;
    const step = Math.max(2, Math.floor(Math.min(w, h) / 64));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const p = at(x, y);
        const l = relLum(p);
        if (l < 0.16 || l > 0.84) continue; // 排除近黑（文字）與近白（背景）
        if (manhattan(p, bg) < 40) continue; // 排除貼近背景者
        const s = saturation(p);
        if (s > bestSat) {
          bestSat = s;
          best = p;
        }
      }
    }
    const accent = best && bestSat >= 0.28 ? toHex(best) : NEUTRAL_LIGHT_THEME.accent;

    return { bg: toHex(bg), text, accent };
  } catch {
    return NEUTRAL_LIGHT_THEME;
  }
}

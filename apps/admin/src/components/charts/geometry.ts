/**
 * 折線/面積路徑投影（Sparkline 與 LineChart 共用）。純函式、無 React。
 * 把一串項目（各取一個數值）投影到矩形繪圖區：算 span/stepX、逐點 x-y、baseline 包夾出面積多邊形。
 * 兩元件各傳自己的幾何（原點、跨距、上下緣）與可選 maxFloor，投影數學完全一致。
 * 泛型攜回原始 item（coords[i].item），供資料點/標籤定位。
 */
export interface PolylineGeom {
  /** 第 0 點的 x（左原點）。 */
  x0: number;
  /** 整條線的水平跨距（末點 x = x0 + spanX）。 */
  spanX: number;
  /** 值為最大時的 y（上緣）。 */
  yTop: number;
  /** 值為最小時的 y（基準線 / 下緣）。 */
  yBase: number;
  /** 若提供，最大值以此為下限（Math.max(...values, maxFloor)）；不提供則取原始最大值。 */
  maxFloor?: number;
}

export interface ProjectedPolyline<T> {
  /** 逐點座標（原始數值，未 toFixed）＋攜回的 item——供資料點/標籤定位。 */
  coords: { x: number; y: number; item: T }[];
  /** 折線 points 字串（各座標 toFixed(2)）。 */
  line: string;
  /** 面積 polygon points 字串（折線 + baseline 包夾）。 */
  area: string;
  min: number;
  max: number;
}

/** 把 items（各以 getValue 取值）投影到 geom 指定的矩形；回傳折線/面積字串與逐點座標。 */
export function projectPolyline<T>(
  items: T[],
  getValue: (item: T) => number,
  geom: PolylineGeom,
): ProjectedPolyline<T> {
  const { x0, spanX, yTop, yBase, maxFloor } = geom;
  const values = items.map(getValue);
  const max = maxFloor === undefined ? Math.max(...values) : Math.max(...values, maxFloor);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const plotH = yBase - yTop;
  const stepX = items.length > 1 ? spanX / (items.length - 1) : 0;
  const coords = items.map((item, i) => ({
    x: x0 + i * stepX,
    y: yBase - ((values[i]! - min) / span) * plotH,
    item,
  }));
  const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const lastX = (x0 + (items.length - 1) * stepX).toFixed(2);
  const area = `${x0},${yBase} ${line} ${lastX},${yBase}`;
  return { coords, line, area, min, max };
}

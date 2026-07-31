import type { CSSProperties, ReactNode } from "react";
import type { SlideBlock, SlideSpec, SlideTheme } from "@meetcopilot/shared";
import { API_BASE } from "@/lib/api";
import { SlideGlyph } from "./slide-icons";
import { SlideChart } from "./slide-chart";
import { chartSeriesOk, describeShape } from "./chart-guard";

/**
 * 解析 image block 的 src。匯入原簡報頁的 dataUri 現為**相對簽章 URL**（`/api/decks/:id/assets/:assetId?exp=&sig=`）——
 * 相對 `/api/...` 路徑須對 API base 解析，否則瀏覽器會誤打到 web 前端 origin（跨 origin 部署時破圖）。
 * `data:` inline 圖與絕對 http(s) URL 原樣返回。
 */
function resolveImageSrc(src: string): string {
  return src.startsWith("/api/") ? `${API_BASE}${src}` : src;
}

export interface SlideRendererProps {
  slide: SlideSpec;
  size: "full" | "thumb";
}

/**
 * 把 slide.theme 映成 .slide 上的 scoped CSS 變數（inline style）；缺的欄位不設，交由 CSS fallback 回 app 預設。
 * 匯入頁帶原簡報 token、生成頁繼承 anchor token——兩者都經此套用，達成視覺一致。
 *
 * v2 note：pre-meeting AI 生圖（kind='background'）沒有新增 contract 欄位——生成的 dataUri 由 studio 編輯器
 * 寫進 `theme.bg`（一個 CSS background 值，如 `url("data:...") center/cover`；bg 型別本就是 string）。
 * 偵測到 bg 是圖片時掛 `slide--bgimg` 讓 CSS 加暗色 scrim 保住文字對比。
 */
export function themeStyle(theme: SlideTheme | undefined): CSSProperties {
  if (!theme) return {};
  const vars: Record<string, string> = {};
  if (theme.bg) vars["--slide-bg"] = theme.bg;
  if (theme.text) vars["--slide-text"] = theme.text;
  if (theme.accent) {
    vars["--slide-accent"] = theme.accent;
    // 有匯入/繼承主色時，把 mesh 漸層與圖表多序列用的 accent-2/-3 也從主色衍生（淺色調＋深色調、同色系），
    // 取代 CSS 預設的 app 招牌紫/粉（#7c6cff/#ff5d9e）——讓生成補充頁與匯入 deck 同一色調，收斂風格落差。
    vars["--slide-accent-2"] = `color-mix(in srgb, ${theme.accent} 58%, white)`;
    vars["--slide-accent-3"] = `color-mix(in srgb, ${theme.accent} 66%, black)`;
  }
  if (theme.headingFont) vars["--slide-heading-font"] = theme.headingFont;
  if (theme.bodyFont) vars["--slide-body-font"] = theme.bodyFont;
  return vars as CSSProperties;
}

/** bg 值是否為圖片背景（url(...)）——決定要不要加 scrim 保住文字對比。 */
export function bgIsImage(theme: SlideTheme | undefined): boolean {
  return typeof theme?.bg === "string" && theme.bg.trimStart().startsWith("url(");
}

/** `.slide` 的完整 class 字串（單一真相；SlideRenderer 與 EditableSlide 共用，`extra` 可附 slide--editing 等）。 */
export function slideClass(slide: SlideSpec, size: string, ...extra: string[]): string {
  return ["slide", `slide--${slide.template}`, `slide--${size}`, bgIsImage(slide.theme) ? "slide--bgimg" : "", ...extra]
    .filter(Boolean)
    .join(" ");
}

/**
 * 渲染 SlideSpec。內容一律以 React text node 呈現（不用 dangerouslySetInnerHTML）——
 * 這就是本元件的 sanitize 策略：LLM 生成或匯入內容永遠不會被當成 HTML 解析。
 */
export function SlideRenderer({ slide, size }: SlideRendererProps) {
  return (
    <div className={slideClass(slide, size)} style={themeStyle(slide.theme)}>
      <div className="slide__body">
        {slide.eyebrow ? <div className="slide__eyebrow">{slide.eyebrow}</div> : null}
        {slide.blocks.map((block, index) => renderSlideBlock(block, index))}
      </div>
      {slide.theme?.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- dataUri 品牌 logo，非 Next 靜態資產
        <img className="slide__logo" src={slide.theme.logo} alt="" />
      ) : null}
    </div>
  );
}

export default SlideRenderer;

/**
 * 單一 block → 顯示 DOM（純函式，單一顯示真相；SlideRenderer 與 EditableSlide 的非編輯態共用，確保像素一致）。
 *
 * **防炸**：一顆壞 block（LLM 亂回、舊資料缺欄位 → `block.headers.map` 之類直接 throw）不得炸掉整頁／整場會議，
 * 故逐 block 包 try/catch：壞的回 null 跳過並在 console 留一行，好的照渲染。正常路徑經由內層函式，
 * 輸出**逐字不變**（slide-legacy-lock.test.ts 的原始碼片段鎖定即證明既有分支一個字都沒動）。
 */
export function renderSlideBlock(block: SlideBlock, key: number): ReactNode {
  try {
    return renderSlideBlockInner(block, key);
  } catch (err) {
    console.warn(`[slide] 跳過壞掉的 block #${key}（type=${(block as { type?: string } | null)?.type}）：${String(err)}`);
    return null;
  }
}

function renderSlideBlockInner(block: SlideBlock, key: number): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <h1 key={key} className="slide-block slide-block--heading">
          {block.text}
        </h1>
      );

    case "subheading":
      return (
        <h2 key={key} className="slide-block slide-block--subheading">
          {block.text}
        </h2>
      );

    case "bullets":
      // marker 省略（或 "dot"）時 class 字串必須逐字等於擴充前的 "slide-block slide-block--bullets"（舊 deck 回歸鎖定）。
      return (
        <ul
          key={key}
          className={["slide-block", "slide-block--bullets", block.marker && block.marker !== "dot" ? `bullets--${block.marker}` : ""]
            .filter(Boolean)
            .join(" ")}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ul>
      );

    case "paragraph":
      return (
        <p key={key} className="slide-block slide-block--paragraph">
          {block.text}
        </p>
      );

    case "quote":
      return (
        <blockquote key={key} className="slide-block slide-block--quote">
          <p>{block.text}</p>
          {block.attribution ? <cite>{block.attribution}</cite> : null}
        </blockquote>
      );

    case "stat":
      // desc 未帶時輸出與擴充前逐字相同（多一個 null 子節點不產生 DOM）。
      return (
        <div key={key} className="slide-block slide-block--stat">
          <div className="stat__value">{block.value}</div>
          <div className="stat__label">{block.label}</div>
          {block.desc ? <div className="stat__desc">{block.desc}</div> : null}
        </div>
      );

    case "features":
      return (
        <div key={key} className={`slide-block slide-block--features feat-count-${block.features.length}`}>
          {block.features.map((f, i) => (
            <div key={i} className="feature">
              <span className="feature__icon">
                <SlideGlyph name={f.icon} />
              </span>
              <div className="feature__text">
                <div className="feature__title">{f.title}</div>
                {f.desc ? <div className="feature__desc">{f.desc}</div> : null}
              </div>
            </div>
          ))}
        </div>
      );

    case "chart": {
      // 防炸（第一層，擋在建立 element「之前」）：SlideChart 是稍後才由 React 執行的，
      // 那時的 throw 已經在本函式的 try/catch 之外 → 會炸掉整頁。詳見 chart-guard.ts。
      if (!chartSeriesOk(block.series, block.series2)) {
        console.warn(
          `[slide] 跳過 chart block #${key}：series 形狀不合格（series=${describeShape(block.series)}, series2=${describeShape(block.series2)}）`,
        );
        return null;
      }
      return (
        <SlideChart
          key={key}
          chartType={block.chartType}
          series={block.series}
          caption={block.caption}
          series2={block.series2}
          seriesNames={block.seriesNames}
          centerValue={block.centerValue}
          centerLabel={block.centerLabel}
        />
      );
    }

    case "table":
      return renderTableBlock(block, key);

    case "timeline":
      return renderTimelineBlock(block, key);

    case "steps":
      return renderStepsBlock(block, key);

    case "image":
      return (
        <div key={key} className="slide-block slide-block--image">
          {/* eslint-disable-next-line @next/next/no-img-element -- dataUri 或簽章 asset URL，非 Next 靜態資產 */}
          <img src={resolveImageSrc(block.dataUri)} alt={block.alt ?? ""} />
        </div>
      );

    case "two-col":
      return (
        <div key={key} className="slide-block slide-block--two-col">
          <div className="two-col__left">{block.left.map((child, childIndex) => renderSlideBlock(child, childIndex))}</div>
          <div className="two-col__right">
            {block.right.map((child, childIndex) => renderSlideBlock(child, childIndex))}
          </div>
        </div>
      );

    default: {
      // 窮舉檢查：若 SlideBlock 新增變體，這裡會編譯期報錯，提醒補上對應渲染分支。
      const exhaustiveCheck: never = block;
      // 執行期若真的收到未知型別（舊/新版本資料不同步），回 null 跳過——把物件當 ReactNode 回去 React 會直接炸整頁。
      void exhaustiveCheck;
      return null;
    }
  }
}

/** 0–100 夾取（timeline 的 startPct/widthPct 來自 LLM，必須夾住才不會溢出軌道槽）。 */
function clampPct(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

/**
 * 比較矩陣（`comparison-matrix` 版式的主角）。欄數由 headers 決定並寫進 `--table-cols`，
 * 首欄為列標題欄（設計稿的 headers[0] 常為空字串）。highlightColumn 標記自家方案欄。
 * 用 grid（非 <table>）以吃 `grid-auto-rows:1fr` 的等高列；語意由 role 補齊。
 */
function renderTableBlock(block: Extract<SlideBlock, { type: "table" }>, key: number): ReactNode {
  const cols = Math.max(1, block.headers.length);
  // 軌道清單整串以 CSS 變數傳給每一列：首欄較寬（列標題），其餘等分。
  // （`repeat()` 的重複次數不吃 calc()，故直接組出完整 track list。）
  const tracks = `minmax(0,1.6fr)${" minmax(0,1fr)".repeat(Math.max(0, cols - 1))}`;
  const cellClass = (rowIndex: number, colIndex: number) =>
    [
      "table__cell",
      rowIndex < 0 ? "table__cell--head" : "",
      colIndex === 0 ? "table__cell--rowhead" : "",
      colIndex === block.highlightColumn ? "table__cell--hl" : "",
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <div
      key={key}
      className="slide-block slide-block--table"
      role="table"
      style={{ ["--table-tracks" as string]: tracks }}
    >
      <div className="table__row" role="row">
        {block.headers.map((h, i) => (
          <div key={i} className={cellClass(-1, i)} role="columnheader">
            {h}
          </div>
        ))}
      </div>
      {block.rows.map((row, r) => (
        <div className="table__row" role="row" key={r}>
          {row.slice(0, cols).map((c, i) => (
            <div key={i} className={cellClass(r, i)} role="cell">
              {c}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 時間表（甘特）：上緣刻度列 ＋ 下方軌道條。色階走 emphasis 語意，由 CSS 從 --slide-accent 衍生。 */
function renderTimelineBlock(block: Extract<SlideBlock, { type: "timeline" }>, key: number): ReactNode {
  return (
    <div key={key} className="slide-block slide-block--timeline">
      {block.ticks.length ? (
        <div className="timeline__ticks" style={{ ["--tick-cols" as string]: String(block.ticks.length) }}>
          {block.ticks.map((t, i) => (
            <div className={`timeline__tick timeline__tick--${t.emphasis ?? "on"}`} key={i}>
              <span className="timeline__tick-bar" />
              <span className="timeline__tick-name">{t.name}</span>
              {t.title ? <span className="timeline__tick-title">{t.title}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="timeline__tracks">
        {block.tracks.map((t, i) => (
          <div className="timeline__track" key={i}>
            <span className="timeline__track-label">{t.label}</span>
            <span className="timeline__track-slot">
              <span
                className={`timeline__bar timeline__bar--${t.emphasis ?? "on"}`}
                style={{ left: `${clampPct(t.startPct)}%`, width: `${Math.max(2, clampPct(t.widthPct))}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 流程步驟：橫排等分欄；序號（01/02…）與頂部色條由渲染器衍生，不進資料。 */
function renderStepsBlock(block: Extract<SlideBlock, { type: "steps" }>, key: number): ReactNode {
  return (
    <div key={key} className={`slide-block slide-block--steps step-count-${block.steps.length}`}>
      {block.steps.map((s, i) => (
        <div className={`step step--tone-${i % 3}`} key={i}>
          <span className="step__no">{String(i + 1).padStart(2, "0")}</span>
          <span className="step__title">{s.title}</span>
          {s.desc ? <span className="step__desc">{s.desc}</span> : null}
          {s.owner ? <span className="step__owner">{s.owner}</span> : null}
        </div>
      ))}
    </div>
  );
}

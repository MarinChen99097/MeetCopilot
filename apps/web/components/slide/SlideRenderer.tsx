import type { CSSProperties, ReactNode } from "react";
import type { SlideBlock, SlideSpec, SlideTheme } from "@meetcopilot/shared";
import { API_BASE } from "@/lib/api";
import { SlideGlyph } from "./slide-icons";
import { SlideChart } from "./slide-chart";

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
function themeStyle(theme: SlideTheme | undefined): CSSProperties {
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
function bgIsImage(theme: SlideTheme | undefined): boolean {
  return typeof theme?.bg === "string" && theme.bg.trimStart().startsWith("url(");
}

/**
 * 渲染 SlideSpec。內容一律以 React text node 呈現（不用 dangerouslySetInnerHTML）——
 * 這就是本元件的 sanitize 策略：LLM 生成或匯入內容永遠不會被當成 HTML 解析。
 */
export function SlideRenderer({ slide, size }: SlideRendererProps) {
  const cls = [
    "slide",
    `slide--${slide.template}`,
    `slide--${size}`,
    bgIsImage(slide.theme) ? "slide--bgimg" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={themeStyle(slide.theme)}>
      <div className="slide__body">
        {slide.eyebrow ? <div className="slide__eyebrow">{slide.eyebrow}</div> : null}
        {slide.blocks.map((block, index) => renderBlock(block, index))}
      </div>
      {slide.theme?.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- dataUri 品牌 logo，非 Next 靜態資產
        <img className="slide__logo" src={slide.theme.logo} alt="" />
      ) : null}
    </div>
  );
}

export default SlideRenderer;

function renderBlock(block: SlideBlock, key: number): ReactNode {
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
      return (
        <ul key={key} className="slide-block slide-block--bullets">
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
      return (
        <div key={key} className="slide-block slide-block--stat">
          <div className="stat__value">{block.value}</div>
          <div className="stat__label">{block.label}</div>
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

    case "chart":
      return <SlideChart key={key} chartType={block.chartType} series={block.series} caption={block.caption} />;

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
          <div className="two-col__left">{block.left.map((child, childIndex) => renderBlock(child, childIndex))}</div>
          <div className="two-col__right">
            {block.right.map((child, childIndex) => renderBlock(child, childIndex))}
          </div>
        </div>
      );

    default: {
      // 窮舉檢查：若 SlideBlock 新增變體，這裡會編譯期報錯，提醒補上對應渲染分支。
      const exhaustiveCheck: never = block;
      return exhaustiveCheck;
    }
  }
}

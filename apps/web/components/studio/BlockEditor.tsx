"use client";

import type { ReactNode } from "react";
import {
  SLIDE_ICONS,
  SLIDE_TEMPLATES,
  CHART_TYPES,
  type ChartType,
  type FeatureItem,
  type SlideBlock,
  type SlideIcon,
  type SlideSpec,
  type SlideTemplate,
} from "@meetcopilot/shared";
import { blockMove, blockRemove, blockReplace, newBlock } from "./slide-block-ops";

/** 版型／區塊型別的中文友善標籤（取代原本直出的英文 enum 代碼）。缺項 fallback 回原值。 */
const TEMPLATE_LABEL: Partial<Record<SlideTemplate, string>> = {
  title: "封面",
  section: "分節",
  content: "內容",
  stats: "數據",
  closing: "結語",
  "image-full": "整頁圖",
};
const ADD_LABEL: Record<string, string> = {
  heading: "大標題",
  subheading: "副標題",
  paragraph: "段落",
  bullets: "條列",
  quote: "引言",
  stat: "數據",
  features: "圖示要點",
  chart: "圖表",
};

/**
 * BlockEditor — 右側屬性面板：以 SlideSpec 的 blocks 結構呈現與編輯（非寫死單一版型）。
 * 純受控：父層持 draft SlideSpec，本元件回 `onChange(nextSlide)`；存檔（PATCH）由父層 SlideEditor 負責。
 * 支援每種 block 型別的主要欄位編輯 + eyebrow + template；two-col 遞迴編輯左右子區塊。
 */
export function BlockEditor({ slide, onChange }: { slide: SlideSpec; onChange: (next: SlideSpec) => void }) {
  const setBlocks = (blocks: SlideBlock[]) => onChange({ ...slide, blocks });
  const updateBlock = (i: number, next: SlideBlock) => setBlocks(blockReplace(slide.blocks, i, next));
  const removeBlock = (i: number) => setBlocks(blockRemove(slide.blocks, i));
  const moveBlock = (i: number, dir: -1 | 1) => setBlocks(blockMove(slide.blocks, i, dir));

  return (
    <div className="mc-blocks">
      <label className="mc-field">
        <span>版型 template</span>
        <select
          className="mc-input"
          value={slide.template}
          onChange={(e) => onChange({ ...slide, template: e.target.value as SlideTemplate })}
        >
          {SLIDE_TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {TEMPLATE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </label>

      <label className="mc-field">
        <span>eyebrow（小標籤，可空）</span>
        <input
          className="mc-input"
          value={slide.eyebrow ?? ""}
          onChange={(e) => onChange({ ...slide, eyebrow: e.target.value || undefined })}
          placeholder="例：GEOPOLITICS BRIEF / 01"
        />
      </label>

      <div className="mc-blocks__list">
        {slide.blocks.map((block, i) => (
          <fieldset key={i} className="mc-blk">
            <legend className="mc-blk__legend">
              <span className="mc-blk__type">{block.type}</span>
              <span className="mc-blk__ctrls">
                <button type="button" className="mc-iconbtn" aria-label="上移" onClick={() => moveBlock(i, -1)}>
                  ↑
                </button>
                <button type="button" className="mc-iconbtn" aria-label="下移" onClick={() => moveBlock(i, 1)}>
                  ↓
                </button>
                <button type="button" className="mc-iconbtn mc-iconbtn--danger" aria-label="刪除" onClick={() => removeBlock(i)}>
                  ×
                </button>
              </span>
            </legend>
            <BlockFields block={block} onChange={(nb) => updateBlock(i, nb)} />
          </fieldset>
        ))}
        {slide.blocks.length === 0 ? <p className="mc-blocks__empty">這一頁沒有內容區塊。用下方按鈕新增。</p> : null}
      </div>

      <div className="mc-blocks__add">
        <span className="mc-blocks__addlabel">新增區塊</span>
        {(["heading", "subheading", "paragraph", "bullets", "quote", "stat", "features", "chart"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="mc-btn mc-btn--ghost mc-btn--sm"
            onClick={() => setBlocks([...slide.blocks, newBlock(t)])}
          >
            ＋ {ADD_LABEL[t] ?? t}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 依 block 型別產出對應輸入欄位。two-col 遞迴。 */
function BlockFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }): ReactNode {
  switch (block.type) {
    case "heading":
    case "subheading":
    case "paragraph":
      return (
        <label className="mc-field">
          <span>文字</span>
          <textarea
            className="mc-input mc-textarea"
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
          />
        </label>
      );

    case "quote":
      return (
        <>
          <label className="mc-field">
            <span>引言</span>
            <textarea
              className="mc-input mc-textarea"
              value={block.text}
              onChange={(e) => onChange({ ...block, text: e.target.value })}
            />
          </label>
          <label className="mc-field">
            <span>出處（可空）</span>
            <input
              className="mc-input"
              value={block.attribution ?? ""}
              onChange={(e) => onChange({ ...block, attribution: e.target.value || undefined })}
            />
          </label>
        </>
      );

    case "stat":
      return (
        <div className="mc-blk__row">
          <label className="mc-field mc-field--grow">
            <span>數值</span>
            <input className="mc-input" value={block.value} onChange={(e) => onChange({ ...block, value: e.target.value })} />
          </label>
          <label className="mc-field mc-field--grow">
            <span>說明</span>
            <input className="mc-input" value={block.label} onChange={(e) => onChange({ ...block, label: e.target.value })} />
          </label>
        </div>
      );

    case "bullets":
      return (
        <div className="mc-field">
          <span>清單項目</span>
          {block.items.map((item, i) => (
            <div key={i} className="mc-blk__row">
              <input
                className="mc-input"
                value={item}
                onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              <button
                type="button"
                className="mc-iconbtn mc-iconbtn--danger"
                aria-label="移除項目"
                onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mc-btn mc-btn--ghost mc-btn--sm"
            onClick={() => onChange({ ...block, items: [...block.items, ""] })}
          >
            + 項目
          </button>
        </div>
      );

    case "features":
      return (
        <div className="mc-field">
          <span>圖示要點</span>
          {block.features.map((f, i) => (
            <div key={i} className="mc-feat-edit">
              <select
                className="mc-input"
                value={f.icon ?? ""}
                onChange={(e) => updateFeature(block, i, { icon: (e.target.value || undefined) as SlideIcon | undefined }, onChange)}
              >
                <option value="">（無圖示）</option>
                {SLIDE_ICONS.map((ic) => (
                  <option key={ic} value={ic}>
                    {ic}
                  </option>
                ))}
              </select>
              <input
                className="mc-input"
                placeholder="標題"
                value={f.title}
                onChange={(e) => updateFeature(block, i, { title: e.target.value }, onChange)}
              />
              <input
                className="mc-input"
                placeholder="說明（可空）"
                value={f.desc ?? ""}
                onChange={(e) => updateFeature(block, i, { desc: e.target.value || undefined }, onChange)}
              />
              <button
                type="button"
                className="mc-iconbtn mc-iconbtn--danger"
                aria-label="移除要點"
                onClick={() => onChange({ ...block, features: block.features.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mc-btn mc-btn--ghost mc-btn--sm"
            onClick={() => onChange({ ...block, features: [...block.features, { title: "" }] })}
          >
            + 要點
          </button>
        </div>
      );

    case "chart":
      return (
        <div className="mc-field">
          <label className="mc-field">
            <span>圖表類型</span>
            <select
              className="mc-input"
              value={block.chartType}
              onChange={(e) => onChange({ ...block, chartType: e.target.value as ChartType })}
            >
              {CHART_TYPES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {block.series.map((p, i) => (
            <div key={i} className="mc-blk__row">
              <input
                className="mc-input"
                placeholder="標籤"
                value={p.label}
                onChange={(e) =>
                  onChange({ ...block, series: block.series.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                }
              />
              <input
                className="mc-input mc-input--num"
                type="number"
                placeholder="數值"
                value={p.value}
                onChange={(e) =>
                  onChange({
                    ...block,
                    series: block.series.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)),
                  })
                }
              />
              <button
                type="button"
                className="mc-iconbtn mc-iconbtn--danger"
                aria-label="移除資料點"
                onClick={() => onChange({ ...block, series: block.series.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mc-btn mc-btn--ghost mc-btn--sm"
            onClick={() => onChange({ ...block, series: [...block.series, { label: "", value: 0 }] })}
          >
            + 資料點
          </button>
          <label className="mc-field">
            <span>圖說（可空）</span>
            <input
              className="mc-input"
              value={block.caption ?? ""}
              onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })}
            />
          </label>
        </div>
      );

    case "image":
      return (
        <label className="mc-field">
          <span>替代文字 alt（圖片由 AI 生圖 job 套入）</span>
          <input
            className="mc-input"
            value={block.alt ?? ""}
            onChange={(e) => onChange({ ...block, alt: e.target.value || undefined })}
          />
        </label>
      );

    case "two-col":
      return (
        <div className="mc-twocol-edit">
          <div>
            <p className="mc-twocol-edit__h">左欄</p>
            {block.left.map((child, i) => (
              <div key={i} className="mc-blk mc-blk--nested">
                <span className="mc-blk__type">{child.type}</span>
                <BlockFields
                  block={child}
                  onChange={(nb) => onChange({ ...block, left: block.left.map((x, j) => (j === i ? nb : x)) })}
                />
              </div>
            ))}
          </div>
          <div>
            <p className="mc-twocol-edit__h">右欄</p>
            {block.right.map((child, i) => (
              <div key={i} className="mc-blk mc-blk--nested">
                <span className="mc-blk__type">{child.type}</span>
                <BlockFields
                  block={child}
                  onChange={(nb) => onChange({ ...block, right: block.right.map((x, j) => (j === i ? nb : x)) })}
                />
              </div>
            ))}
          </div>
        </div>
      );

    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

function updateFeature(
  block: Extract<SlideBlock, { type: "features" }>,
  i: number,
  patch: Partial<FeatureItem>,
  onChange: (b: SlideBlock) => void,
) {
  onChange({ ...block, features: block.features.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
}


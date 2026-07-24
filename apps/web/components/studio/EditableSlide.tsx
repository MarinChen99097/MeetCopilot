"use client";

import { type ReactNode } from "react";
import type { SlideBlock, SlideSpec } from "@meetcopilot/shared";
import { renderSlideBlock, themeStyle, slideClass } from "@/components/slide/SlideRenderer";
import { InlineText } from "@/components/ui/InlineText";
import { blockMove, blockRemove, blockReplace } from "./slide-block-ops";

/**
 * EditableSlide — WYSIWYG（所見即所得）投影片編輯器（C1：文字類就地編輯＋區塊工具列）。
 *
 * 與 SlideRenderer 像素一致：沿用**同一組** studio-present.css class（`slideClass`）與 `themeStyle`；
 * 非編輯態 block 直接呼叫 export 的 `renderSlideBlock`（單一顯示真相，present/thumb/sim 唯讀路徑不受影響）。
 * 文字類 block（heading/subheading/paragraph/quote）與 eyebrow 用 `InlineText` 就地編輯。
 * 其餘型別（features/stat/bullets/chart/two-col/image）本 cycle 唯讀顯示（C2/C3 再就地化），編輯走右側過渡面板。
 *
 * 受控：父持 draft SlideSpec，`onChange(next)` 回寫（沿用 SlideEditor 的 setDraft/persist/save，不新增存檔管線）。
 * readOnly 不進本元件——SlideEditor 在 readOnly 時改掛唯讀 SlideRenderer。
 */
export function EditableSlide({ slide, onChange }: { slide: SlideSpec; onChange: (next: SlideSpec) => void }) {
  const setBlocks = (blocks: SlideBlock[]) => onChange({ ...slide, blocks });

  return (
    <div className={slideClass(slide, "full", "slide--editing")} style={themeStyle(slide.theme)}>
      <div className="slide__body">
        {/* eyebrow：有值就地改；空值於編輯態顯示「＋ 小標籤」槽。 */}
        <div className="slide__eyebrow mc-eyebrow-edit">
          <InlineText
            value={slide.eyebrow ?? ""}
            placeholder="＋ 小標籤（可空）"
            onCommit={(v) => onChange({ ...slide, eyebrow: v.trim() || undefined })}
          />
        </div>

        {slide.blocks.map((block, i) => (
          <div className="mc-eblk" key={i}>
            <span className="mc-eblk__tools" role="toolbar" aria-label={`${block.type} 區塊工具`}>
              <button
                type="button"
                className="mc-iconbtn"
                aria-label="上移"
                disabled={i === 0}
                onClick={() => setBlocks(blockMove(slide.blocks, i, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="mc-iconbtn"
                aria-label="下移"
                disabled={i === slide.blocks.length - 1}
                onClick={() => setBlocks(blockMove(slide.blocks, i, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="mc-iconbtn mc-iconbtn--danger"
                aria-label="刪除區塊"
                onClick={() => setBlocks(blockRemove(slide.blocks, i))}
              >
                ×
              </button>
            </span>
            <EditableBlock block={block} onChange={(nb) => setBlocks(blockReplace(slide.blocks, i, nb))} />
          </div>
        ))}

        {slide.blocks.length === 0 ? <p className="mc-eblk__empty">這一頁沒有內容區塊。用右側「新增區塊」加入。</p> : null}
      </div>
      {slide.theme?.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- dataUri 品牌 logo，非 Next 靜態資產
        <img className="slide__logo" src={slide.theme.logo} alt="" />
      ) : null}
    </div>
  );
}

/** 文字類 block 就地編輯；其餘型別本 cycle 唯讀（同一 renderSlideBlock 保像素一致）。 */
function EditableBlock({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <h1 className="slide-block slide-block--heading">
          <InlineText value={block.text} placeholder="標題" onCommit={(v) => onChange({ ...block, text: v })} />
        </h1>
      );
    case "subheading":
      return (
        <h2 className="slide-block slide-block--subheading">
          <InlineText value={block.text} placeholder="副標題" onCommit={(v) => onChange({ ...block, text: v })} />
        </h2>
      );
    case "paragraph":
      return (
        <p className="slide-block slide-block--paragraph">
          <InlineText multiline value={block.text} placeholder="段落文字" onCommit={(v) => onChange({ ...block, text: v })} />
        </p>
      );
    case "quote":
      return (
        <blockquote className="slide-block slide-block--quote">
          <p>
            <InlineText multiline value={block.text} placeholder="引言" onCommit={(v) => onChange({ ...block, text: v })} />
          </p>
          <cite>
            <InlineText
              value={block.attribution ?? ""}
              placeholder="＋ 出處（可空）"
              onCommit={(v) => onChange({ ...block, attribution: v.trim() || undefined })}
            />
          </cite>
        </blockquote>
      );
    // 其餘型別本 cycle 唯讀顯示（C2/C3 就地化）。
    default:
      return renderSlideBlock(block, 0);
  }
}

"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import {
  BULLET_MARKERS,
  SLIDE_ICONS,
  SLIDE_TEMPLATES,
  CHART_TYPES,
  type BulletMarker,
  type ChartType,
  type FeatureItem,
  type SlideBlock,
  type SlideIcon,
  type SlideSpec,
  type SlideTemplate,
  type StepItem,
  type TimelineTick,
  type TimelineTrack,
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
  "timeline-gantt": "時間表",
  "comparison-matrix": "方案比較表",
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
  table: "比較表",
  timeline: "時間表",
  steps: "流程步驟",
};
/** bullets 的項目標記（對應 shared BULLET_MARKERS；「無」＝ dot 預設，寫回 undefined 保舊資料形狀）。 */
const MARKER_LABEL: Record<BulletMarker, string> = {
  dot: "圓點（預設）",
  check: "✓ 正向",
  cross: "✕ 負向",
  dash: "— 破折",
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
        {(
          [
            "heading",
            "subheading",
            "paragraph",
            "bullets",
            "quote",
            "stat",
            "features",
            "chart",
            "table",
            "timeline",
            "steps",
          ] as const
        ).map((t) => (
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
        <>
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
          <label className="mc-field">
            <span>補充一句（可空）</span>
            <input
              className="mc-input"
              value={block.desc ?? ""}
              onChange={(e) => onChange({ ...block, desc: e.target.value || undefined })}
            />
          </label>
        </>
      );

    case "bullets":
      return (
        <div className="mc-field">
          <label className="mc-field">
            <span>項目標記</span>
            <select
              className="mc-input"
              value={block.marker ?? "dot"}
              onChange={(e) => {
                const v = e.target.value as BulletMarker;
                onChange({ ...block, marker: v === "dot" ? undefined : v });
              }}
            >
              {BULLET_MARKERS.map((m) => (
                <option key={m} value={m}>
                  {MARKER_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
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
          {block.chartType === "donut" ? (
            <div className="mc-blk__row">
              <label className="mc-field mc-field--grow">
                <span>圓心數字（可空）</span>
                <input
                  className="mc-input"
                  value={block.centerValue ?? ""}
                  onChange={(e) => onChange({ ...block, centerValue: e.target.value || undefined })}
                />
              </label>
              <label className="mc-field mc-field--grow">
                <span>圓心說明（可空）</span>
                <input
                  className="mc-input"
                  value={block.centerLabel ?? ""}
                  onChange={(e) => onChange({ ...block, centerLabel: e.target.value || undefined })}
                />
              </label>
            </div>
          ) : null}
        </div>
      );

    case "table":
      return <TableFields block={block} onChange={onChange} />;

    case "timeline":
      return <TimelineFields block={block} onChange={onChange} />;

    case "steps":
      return (
        <div className="mc-field">
          <span>流程步驟（序號自動產生）</span>
          {block.steps.map((s, i) => (
            <div key={i} className="mc-feat-edit">
              <input
                className="mc-input"
                placeholder="標題"
                value={s.title}
                onChange={(e) => patchStep(block, i, { title: e.target.value }, onChange)}
              />
              <input
                className="mc-input"
                placeholder="說明（可空）"
                value={s.desc ?? ""}
                onChange={(e) => patchStep(block, i, { desc: e.target.value || undefined }, onChange)}
              />
              <input
                className="mc-input"
                placeholder="負責人／時間（可空）"
                value={s.owner ?? ""}
                onChange={(e) => patchStep(block, i, { owner: e.target.value || undefined }, onChange)}
              />
              <button
                type="button"
                className="mc-iconbtn mc-iconbtn--danger"
                aria-label="移除步驟"
                onClick={() => onChange({ ...block, steps: block.steps.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mc-btn mc-btn--ghost mc-btn--sm"
            onClick={() => onChange({ ...block, steps: [...block.steps, { title: "" }] })}
          >
            + 步驟
          </button>
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

function patchStep(
  block: Extract<SlideBlock, { type: "steps" }>,
  i: number,
  patch: Partial<StepItem>,
  onChange: (b: SlideBlock) => void,
) {
  onChange({ ...block, steps: block.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
}

/**
 * 比較表表單：表頭一列 ＋ 每列 N 格（欄數由表頭決定，新增/移除欄同步所有列，
 * 不可能產生列長不等於表頭長度的資料——與 server sanitize 的守門同一條規則）。
 *
 * 2026-08-01 版面重排（使用者實測：右欄表單過長、每格文字擠成「單次運」「極高（」）：
 * 版面從「表頭 N 欄各佔一整列 ＋ 內容列橫排 N 個窄格」改成**一張 2D 網格**（`.mc-tbl`），
 * 表頭與內容格同軌對齊、欄寬下限 132px，欄多時網格自己橫捲。**行為零變更**：
 * setHeader/setCell/addCol/removeCol/刪列 都還是同一組 handler，canRemoveCol≥2 的守門也原封不動。
 */
function TableFields({
  block,
  onChange,
}: {
  block: Extract<SlideBlock, { type: "table" }>;
  onChange: (b: SlideBlock) => void;
}) {
  const cols = block.headers.length;
  // 比較表最少要「列標題欄＋一個比較欄」＝2 欄；再刪下去會變成單欄的偽表格（渲染器的 --table-tracks
  // 只剩列標題軌道、highlightColumn 全失效）。刪到 2 欄就停用移除鈕，而不是讓人刪成壞資料再去救。
  const canRemoveCol = cols > 2;
  const setHeader = (i: number, v: string) =>
    onChange({ ...block, headers: block.headers.map((h, j) => (j === i ? v : h)) });
  const setCell = (r: number, c: number, v: string) =>
    onChange({ ...block, rows: block.rows.map((row, j) => (j === r ? row.map((x, k) => (k === c ? v : x)) : row)) });
  const addCol = () =>
    onChange({ ...block, headers: [...block.headers, ""], rows: block.rows.map((row) => [...row, ""]) });
  const removeCol = (i: number) =>
    onChange({
      ...block,
      headers: block.headers.filter((_, j) => j !== i),
      rows: block.rows.map((row) => row.filter((_, j) => j !== i)),
      highlightColumn:
        block.highlightColumn === undefined || block.highlightColumn === i
          ? undefined
          : block.highlightColumn > i
            ? block.highlightColumn - 1
            : block.highlightColumn,
    });
  return (
    <div className="mc-field">
      <span className="mc-tbl__cap">
        比較表 {cols} 欄 × {block.rows.length} 列：第一欄是列標題，其餘是要比較的方案。欄較多時本表可左右捲動。
      </span>
      <div className="mc-tbl" style={{ "--mc-tbl-cols": cols } as CSSProperties}>
        {/* 表頭列：欄名 ＋ 移除該欄（最少 2 欄，同 canRemoveCol 守門） */}
        {block.headers.map((h, i) => (
          <div key={`h${i}`} className="mc-tbl__head">
            <input
              className="mc-input"
              placeholder={i === 0 ? "（留空）" : "欄名"}
              aria-label={i === 0 ? "列標題欄的欄名（通常留空）" : `第 ${i + 1} 欄欄名`}
              value={h}
              onChange={(e) => setHeader(i, e.target.value)}
            />
            <button
              type="button"
              className="mc-iconbtn mc-iconbtn--sm mc-iconbtn--danger"
              aria-label="移除欄"
              disabled={!canRemoveCol}
              title={canRemoveCol ? "移除這一欄" : "比較表至少要 2 欄"}
              onClick={() => removeCol(i)}
            >
              ×
            </button>
          </div>
        ))}
        <span className="mc-tbl__corner" aria-hidden="true" />

        {/* 內容列：每格垂直對齊上方欄名，列尾是移除該列 */}
        {block.rows.map((row, r) => (
          <Fragment key={`r${r}`}>
            {row.map((cell, c) => {
              // 提示字與無障礙標籤共用同一個欄名，改一個不會漏另一個。
              const colName = c === 0 ? "列標題" : block.headers[c] || `第 ${c + 1} 欄`;
              return (
                <input
                  key={c}
                  className="mc-input"
                  placeholder={colName}
                  aria-label={`第 ${r + 1} 列・${colName}`}
                  value={cell}
                  onChange={(e) => setCell(r, c, e.target.value)}
                />
              );
            })}
            <button
              type="button"
              className="mc-iconbtn mc-iconbtn--sm mc-iconbtn--danger"
              aria-label="移除列"
              onClick={() => onChange({ ...block, rows: block.rows.filter((_, j) => j !== r) })}
            >
              ×
            </button>
          </Fragment>
        ))}
      </div>

      <div className="mc-tbl__acts">
        <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={addCol}>
          + 欄
        </button>
        <button
          type="button"
          className="mc-btn mc-btn--ghost mc-btn--sm"
          onClick={() => onChange({ ...block, rows: [...block.rows, Array.from({ length: cols }, () => "")] })}
        >
          + 列
        </button>
      </div>

      <label className="mc-field">
        <span>要強調哪一欄（自家方案）</span>
        <select
          className="mc-input"
          value={block.highlightColumn ?? ""}
          onChange={(e) => onChange({ ...block, highlightColumn: e.target.value === "" ? undefined : Number(e.target.value) })}
        >
          <option value="">（不強調）</option>
          {block.headers.map((h, i) =>
            i === 0 ? null : (
              <option key={i} value={i}>
                {h || `第 ${i + 1} 欄`}
              </option>
            ),
          )}
        </select>
      </label>
    </div>
  );
}

/** 時間表表單：上緣刻度（名稱＋標題）＋ 軌道（名稱＋起點%／長度%）。 */
function TimelineFields({
  block,
  onChange,
}: {
  block: Extract<SlideBlock, { type: "timeline" }>;
  onChange: (b: SlideBlock) => void;
}) {
  const patchTick = (i: number, patch: Partial<TimelineTick>) =>
    onChange({ ...block, ticks: block.ticks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const patchTrack = (i: number, patch: Partial<TimelineTrack>) =>
    onChange({ ...block, tracks: block.tracks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <div className="mc-field">
      <span>時間刻度</span>
      {block.ticks.map((t, i) => (
        <div key={i} className="mc-blk__row">
          <input className="mc-input" placeholder="第 1–2 週" value={t.name} onChange={(e) => patchTick(i, { name: e.target.value })} />
          <input
            className="mc-input"
            placeholder="這段要做什麼（可空）"
            value={t.title ?? ""}
            onChange={(e) => patchTick(i, { title: e.target.value || undefined })}
          />
          <button
            type="button"
            className="mc-iconbtn mc-iconbtn--danger"
            aria-label="移除刻度"
            onClick={() => onChange({ ...block, ticks: block.ticks.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mc-btn mc-btn--ghost mc-btn--sm"
        onClick={() => onChange({ ...block, ticks: [...block.ticks, { name: "" }] })}
      >
        + 刻度
      </button>

      <span>軌道（起點／長度以整條時間軸的百分比計）</span>
      {block.tracks.map((t, i) => (
        <div key={i} className="mc-blk__row">
          <input className="mc-input" placeholder="軌道名稱" value={t.label} onChange={(e) => patchTrack(i, { label: e.target.value })} />
          <input
            className="mc-input mc-input--num"
            type="number"
            placeholder="起點 %"
            value={t.startPct}
            onChange={(e) => patchTrack(i, { startPct: Number(e.target.value) })}
          />
          <input
            className="mc-input mc-input--num"
            type="number"
            placeholder="長度 %"
            value={t.widthPct}
            onChange={(e) => patchTrack(i, { widthPct: Number(e.target.value) })}
          />
          <button
            type="button"
            className="mc-iconbtn mc-iconbtn--danger"
            aria-label="移除軌道"
            onClick={() => onChange({ ...block, tracks: block.tracks.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mc-btn mc-btn--ghost mc-btn--sm"
        onClick={() => onChange({ ...block, tracks: [...block.tracks, { label: "", startPct: 0, widthPct: 40 }] })}
      >
        + 軌道
      </button>
    </div>
  );
}


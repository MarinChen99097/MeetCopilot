"use client";

import type { FieldProvenance } from "@meetcopilot/shared";
import { isTrusted } from "@meetcopilot/shared";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { Spinner } from "./Spinner";

/**
 * ProvenanceBadge — a field's 來源(crawler/human/llm/import) ＋ 信心 ＋ 是否 verified（PROMPT 0 通用元件 #3）.
 * 已信任（human 或 verified=1）→ 綠勾、視覺與爬蟲猜測區隔；未驗證 → 顯示來源＋可點「確認」。
 * `onConfirm` omitted (e.g. already verified) hides the 確認 button.
 */
const SOURCE_LABEL: Record<string, string> = {
  crawler: "爬蟲",
  human: "人工",
  llm: "AI",
  import: "匯入",
};

export function ProvenanceBadge({
  prov,
  confirming,
  onConfirm,
}: {
  prov: FieldProvenance;
  confirming?: boolean;
  onConfirm?: () => void;
}) {
  const trusted = isTrusted(prov);
  const srcLabel = SOURCE_LABEL[prov.filledBy] ?? prov.filledBy;
  const canConfirm = !trusted && !!onConfirm;

  return (
    <span className={`mc-prov ${trusted ? "mc-prov--trusted" : "mc-prov--guess"}`}>
      <span className="mc-prov__src" title={prov.sourceUrl ? `來源：${prov.sourceUrl}` : `來源：${srcLabel}`}>
        {trusted ? "✓" : "◦"} {srcLabel}
      </span>
      {!trusted ? <ConfidenceBadge value={prov.confidence} /> : null}
      {prov.sourceUrl ? (
        <a className="mc-prov__link" href={prov.sourceUrl} target="_blank" rel="noreferrer noopener" title="開啟來源">
          連結
        </a>
      ) : null}
      {canConfirm ? (
        <button
          type="button"
          className="mc-prov__confirm"
          onClick={onConfirm}
          disabled={confirming}
          aria-label="確認此欄位"
        >
          {confirming ? <Spinner size={11} /> : "✓ 確認"}
        </button>
      ) : null}
      {trusted ? <span className="mc-prov__verified">已驗證</span> : null}
    </span>
  );
}

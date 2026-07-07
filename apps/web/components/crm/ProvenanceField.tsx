"use client";

import { useState, type ReactNode } from "react";
import type { FieldProvenance } from "@meetcopilot/shared";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Spinner } from "@/components/ui/Spinner";

/**
 * ProvenanceField — the soul of /crm: one CRM field row with its value, a ProvenanceBadge
 * (來源/信心/verified), a 確認 button, and 細填 inline edit.
 * - 確認 → onConfirm(fieldName): field becomes verified (value unchanged).
 * - 細填 → onSave(fieldName, newValue): PATCH the entity (server writes filled_by='human').
 * Presentational: all IO is delegated to callbacks; `busyConfirm`/`busySave` drive spinners.
 */
export function ProvenanceField({
  label,
  fieldName,
  value,
  rawValue,
  prov,
  editable = true,
  busyConfirm,
  busySave,
  onConfirm,
  onSave,
}: {
  label: string;
  fieldName: string;
  value: ReactNode;
  rawValue?: string;
  prov?: FieldProvenance;
  editable?: boolean;
  busyConfirm?: boolean;
  busySave?: boolean;
  onConfirm?: (fieldName: string) => void;
  onSave?: (fieldName: string, newValue: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function begin() {
    setDraft(rawValue ?? "");
    setEditing(true);
  }
  function save() {
    onSave?.(fieldName, draft);
    setEditing(false);
  }

  const empty = value === null || value === undefined || value === "" || value === "—";

  return (
    <div className="mc-field-row">
      <div className="mc-field-row__label">{label}</div>
      <div className="mc-field-row__main">
        {editing ? (
          <div className="mc-field-row__edit">
            <input
              className="mc-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={save} disabled={busySave}>
              {busySave ? <Spinner size={13} /> : "儲存"}
            </button>
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        ) : (
          <div className="mc-field-row__value">
            <span className={empty ? "mc-field-row__empty" : undefined}>{empty ? "未填" : value}</span>
            {editable && onSave ? (
              <button type="button" className="mc-field-row__edit-btn" onClick={begin} aria-label={`細填 ${label}`}>
                細填
              </button>
            ) : null}
          </div>
        )}
        <div className="mc-field-row__prov">
          {prov ? (
            <ProvenanceBadge
              prov={prov}
              confirming={busyConfirm}
              onConfirm={onConfirm ? () => onConfirm(fieldName) : undefined}
            />
          ) : (
            <span className="mc-prov mc-prov--none" title="尚無來源紀錄">
              手動欄位
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

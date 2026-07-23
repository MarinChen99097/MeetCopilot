"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { FieldProvenance } from "@meetcopilot/shared";
import { ApiError, confirmProvenance, getProvenance } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

/**
 * useEntityProvenance — loads GET /api/crm/provenance for one entity into a fieldName→row map,
 * and wires the two trust actions:
 *   - confirm(fieldName): optimistic verified=1, POST provenance/confirm, rollback + toast on fail.
 *   - save(fieldName, value): PATCH the entity via `patchFn` (server writes filled_by='human'),
 *     then reloads provenance and calls onChanged so the parent refetches the entity value.
 *
 * ASSUMPTION (flagged for backend): provenance.fieldName is the camelCase wire field name (matching
 * the entity shape), so the UI can align a field to its provenance row without knowing DB columns.
 *
 * `patchFn` is typed loosely (Record<string, unknown>) so a single inline-edit string can target any
 * field; the concrete typed client (updateCompany/updateContact) casts at the call site.
 */
export function useEntityProvenance(
  entityType: string,
  entityId: string,
  patchFn: (id: string, patch: Record<string, unknown>) => Promise<unknown>,
  onChanged: () => void,
) {
  const toast = useToast();
  const [provMap, setProvMap] = useState<Record<string, FieldProvenance>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyConfirm, setBusyConfirm] = useState<Set<string>>(new Set());
  const [busySave, setBusySave] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getProvenance(entityType, entityId)
      .then((rows) => {
        if (!alive) return;
        const map: Record<string, FieldProvenance> = {};
        for (const r of rows) map[r.fieldName] = r;
        setProvMap(map);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "載入來源失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [entityType, entityId]);

  useEffect(() => reload(), [reload]);

  const mark = (set: Dispatch<SetStateAction<Set<string>>>, field: string, on: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });

  const confirm = useCallback(
    async (fieldName: string) => {
      const prev = provMap[fieldName];
      if (!prev) return;
      mark(setBusyConfirm, fieldName, true);
      // optimistic
      setProvMap((m) => ({ ...m, [fieldName]: { ...prev, verified: 1 } }));
      try {
        await confirmProvenance({ entityType, entityId, fieldName });
        toast.push({ kind: "success", message: "已確認欄位" });
      } catch (err) {
        setProvMap((m) => ({ ...m, [fieldName]: prev })); // rollback
        toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "確認失敗" });
      } finally {
        mark(setBusyConfirm, fieldName, false);
      }
    },
    [entityId, entityType, provMap, toast],
  );

  const save = useCallback(
    async (fieldName: string, value: unknown) => {
      mark(setBusySave, fieldName, true);
      try {
        await patchFn(entityId, { [fieldName]: value });
        toast.push({ kind: "success", message: "已細填（人工值）" });
        onChanged();
        reload();
      } catch (err) {
        toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "儲存失敗" });
      } finally {
        mark(setBusySave, fieldName, false);
      }
    },
    [entityId, onChanged, patchFn, reload, toast],
  );

  return { provMap, loading, error, reload, confirm, save, busyConfirm, busySave };
}

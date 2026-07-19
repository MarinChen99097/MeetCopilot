"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CrawlMode, CrawlTargetType } from "@meetcopilot/shared";
import { ApiError, enrich, getResearchJob, type EnrichMode, type ResearchJob } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { JobProgressCard } from "@/components/ui/JobProgressCard";
import { Spinner } from "@/components/ui/Spinner";

const POLL_MS = 2500;
/**
 * 逃生口門檻（contract §6）：queued/running 超過 95 分鐘視為「已中斷」（伺服器重啟或逾時）。
 * 65→95 分：deep 全網研究上限拉長（RESEARCH_JOB_TIMEOUT 3.6M→5.4M ms），逃生口須大於伺服器逾時，
 * 否則正常長跑 job 會被前端提前誤判中斷。
 */
const STALE_MS = 95 * 60 * 1000;
const storageKey = (t: CrawlTargetType, id: string) => `mc_enrich_${t}_${id}`;

/**
 * 解析 job 時間錨（createdAt/startedAt）→ epoch ms。wire 形狀依後端而異：
 *  - number：現行 SQLite rowToJob 回 epoch ms，直接用。
 *  - 純數字字串："1752…" → 當 epoch ms。
 *  - ISO／SQLite「YYYY-MM-DD HH:MM:SS」：無 T 先換 T；無時區一律當 UTC（後端存 UTC）→ 補 Z。
 * 解不出 → null。
 */
function toEpochMs(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  let iso = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
  if (!hasTz && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) iso += "Z";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** 逃生口判定：job 仍 queued/running 且距時間錨（startedAt ?? createdAt）已超過 95 分鐘。 */
function isJobStale(job: ResearchJob | null, now: number): boolean {
  if (!job || (job.status !== "queued" && job.status !== "running")) return false;
  const anchor = toEpochMs(job.startedAt) ?? toEpochMs(job.createdAt);
  return anchor != null && now - anchor > STALE_MS;
}

/**
 * 研究單一入口（RESEARCH_UPGRADE_CONTRACT §3）：移除舊「快速掃描／官網深掃」選項，
 * 一律走 deep（全網＋社群、多輪迭代）。送出 payload 照既有 deep 契約（mode='deep'），不自創欄位。
 * 官網 URL 仍可選填作為研究起點；缺 URL 的 company 後端一律 name-based 全網研究。
 * 路徑分離：本面板走 `enrich()`（研究 job 端點）；DeckWizard 的「從網址匯入」走 `extractUrl`/`extractPdf`
 * （DeckWizard.tsx:134,147），兩者互不影響。
 */
const DEEP_MODE: CrawlMode = "deep";
/**
 * 第二動作「研究更多」（RESEARCH_UPGRADE_CONTRACT more 模式）：在既有資料上補缺＋佐證驗證，較快。
 * 後端讀 DB 空欄為種子做定向雙語查詢、公司非受信任欄改 fill-empty（不覆寫既有）、佐證升信心。
 * `more` 尚未進 shared CrawlMode（server/packages 工程師平行加入 routes MODES）；此處以 api.ts 的
 * EnrichMode（CrawlMode | "more"）本地聯集送出，避免 tsc 因 shared 未就緒而紅。
 */
const MORE_MODE: EnrichMode = "more";

/**
 * EnrichPanel — triggers POST /api/research/enrich then polls GET /api/research/jobs/:id
 * (queued→running→done/failed). The active jobId is persisted per-target in localStorage so the
 * user can leave and come back (contract §3 job model). On done → onDone() so the parent refreshes
 * the entity + provenance to reveal newly-filled fields.
 */
export function EnrichPanel({
  targetType,
  targetId,
  onDone,
}: {
  targetType: CrawlTargetType;
  targetId: string;
  onDone: () => void;
}) {
  const t = useTranslations("enrichPanel");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const timer = useRef<number | null>(null);
  const doneNotified = useRef(false);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(
    (jobId: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const j = await getResearchJob(jobId);
          setJob(j);
          if (j.status === "done" || j.status === "failed") {
            stopPolling();
            window.localStorage.removeItem(storageKey(targetType, targetId));
            if (j.status === "done" && !doneNotified.current) {
              doneNotified.current = true;
              toast.push({ kind: "success", message: `研究完成，填入 ${j.fieldsFilled ?? 0} 個欄位` });
              onDone();
            }
            if (j.status === "failed" && !doneNotified.current) {
              doneNotified.current = true;
              toast.push({ kind: "error", message: `研究失敗：${j.error ?? "未知錯誤"}` });
            }
          }
        } catch {
          // transient poll error: keep the last known job, try again next tick
        }
      };
      void tick();
      timer.current = window.setInterval(tick, POLL_MS);
    },
    [onDone, stopPolling, targetId, targetType, toast],
  );

  // resume an in-flight job on mount
  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(targetType, targetId));
    if (saved) {
      doneNotified.current = false;
      poll(saved);
    }
    return stopPolling;
  }, [poll, stopPolling, targetId, targetType]);

  const active = job?.status === "queued" || job?.status === "running";
  const stale = isJobStale(job, nowTs);

  // 逃生口時鐘：僅在有進行中 job 且尚未 stale 時每 20s 前進 nowTs，讓 stale 即使輪詢中斷（伺服器不可達、
  // tick 一直 throw）也能翻轉為「已中斷」。stale 後停時鐘（deps 含 stale，翻轉即 cleanup）。
  useEffect(() => {
    if (!active || stale) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 20000);
    return () => window.clearInterval(id);
  }, [active, stale]);

  // stale → 停止輪詢（不再打伺服器）；localStorage 保留到使用者「關閉／重試」才清（可重整續判 stale）。
  useEffect(() => {
    if (stale) stopPolling();
  }, [stale, stopPolling]);

  // 關閉工作卡：停輪詢 + 清 job + 清 localStorage（contract §6：關閉時清 localStorage、解鎖研究按鈕）。
  const dismissJob = useCallback(() => {
    stopPolling();
    setJob(null);
    window.localStorage.removeItem(storageKey(targetType, targetId));
  }, [stopPolling, targetId, targetType]);

  // 重試：先清乾淨（含 localStorage）再開面板重新發起（contract §6）。
  const retryJob = useCallback(() => {
    dismissJob();
    setOpen(true);
  }, [dismissJob]);

  async function submit(mode: EnrichMode) {
    setSubmitting(true);
    doneNotified.current = false;
    try {
      const { jobId } = await enrich({
        targetType,
        targetId,
        mode, // deep＝全網深度研究（URL 可選起點）；more＝在既有資料上補缺＋驗證
        url: url.trim() ? url.trim() : undefined,
      });
      window.localStorage.setItem(storageKey(targetType, targetId), jobId);
      // createdAt 客端時戳：首個成功輪詢前的樂觀 job 沒有伺服器時間錨，若伺服器在接受 POST 後、第一個成功
      // tick 前即不可達，isJobStale 的 anchor（startedAt ?? createdAt）會全 null → 逃生口永不翻轉，使用者卡
      // 死在 spinner。補上 client createdAt，讓此情境仍能於 95 分鐘後翻成「已中斷」（contract §6）；一旦有成功
      // 輪詢，setJob 會以伺服器 job（含伺服器 createdAt/startedAt）覆蓋此樂觀值。
      setJob({ id: jobId, targetType, targetId, mode, status: "queued", createdAt: new Date().toISOString() });
      setOpen(false);
      poll(jobId);
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "無法啟動研究" });
    } finally {
      setSubmitting(false);
    }
  }

  // stale 時解鎖「研究此公司」按鈕（contract §6）：busy 只在真正進行中且未中斷時成立。
  const busy = active && !stale;
  const targetNoun = targetType === "company" ? "公司" : "主管";

  return (
    <div className="mc-enrich">
      <div className="mc-enrich__buttons">
        <button
          type="button"
          className="mc-btn mc-btn--accent"
          onClick={() => setOpen((o) => !o)}
          disabled={busy || submitting}
        >
          {busy ? <Spinner size={14} /> : "🔎"} 研究此{targetNoun}
        </button>
        <button
          type="button"
          className="mc-btn mc-btn--ghost mc-btn--sm"
          onClick={() => submit(MORE_MODE)}
          disabled={busy || submitting}
          title={t("moreDesc")}
        >
          {submitting ? <Spinner size={13} /> : "➕"} {t("moreLabel")}
        </button>
      </div>

      {open ? (
        <div className="mc-enrich__panel">
          <div className="mc-enrich__lead">
            <strong>{t("deepEntryLabel")}</strong>
            <small>{t("deepEntryDesc")}</small>
          </div>

          <p className="mc-enrich__warn" role="note">
            {t("timeHint")}
          </p>

          <label className="mc-field">
            <span>官網 URL（可選，作為研究起點）</span>
            <input
              className="mc-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
            {targetType === "company" && !url.trim() ? (
              <small className="mc-field__hint">將以公司名稱做全網深度研究（不需官網）</small>
            ) : null}
          </label>

          <div className="mc-enrich__actions">
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="mc-btn mc-btn--primary mc-btn--sm"
              onClick={() => submit(DEEP_MODE)}
              disabled={submitting}
            >
              {submitting ? <Spinner size={13} /> : t("start")}
            </button>
          </div>
        </div>
      ) : null}

      {job ? (
        <JobProgressCard
          job={job}
          stale={stale}
          staleTitle={t("staleBadge")}
          staleBody={t("staleBody")}
          onRetry={retryJob}
          onDismiss={dismissJob}
        />
      ) : null}
    </div>
  );
}

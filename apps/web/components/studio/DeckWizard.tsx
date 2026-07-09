"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MAX_DECK_PAGES,
  MIN_DECK_PAGES,
  type DeckLanguage,
  type GenerateDeckInput,
} from "@meetcopilot/shared";
import { ApiError, extractPdf, extractUrl, generateDeck } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

// F7: real photos are 1.5–5MB (+33% as base64) and would blow past the request-body cap → 413. Downscale
// on the client (canvas → JPEG) and cap the number of style refs, borrowing v1's ImageUpload approach.
const MAX_REF_IMAGES = 4;
const IMAGE_MAX_EDGE = 1280; // 長邊上限（px）
const IMAGE_QUALITY = 0.82; // JPEG 品質

/**
 * 目標（objective）5 個後端 enum（decks-routes OBJECTIVES）。用下拉杜絕「自由輸入→後端靜默丟值」的 P1：
 * 只可能送出 enum 值或空。標籤/說明走 i18n（deckWizard.objectiveOptions.*）。
 */
const OBJECTIVE_KEYS = ["pitch", "introduce", "fundraise", "report", "training"] as const;

/** 生成中的「誠實假階段」——單次同步請求無伺服器進度事件，故依耗時推進做為體感回饋（不代表真實後端步驟）。 */
const GEN_PHASE_KEYS = ["phaseAnalyze", "phaseCompose", "phaseLayout"] as const;
const GEN_PHASE_STEP_MS = 6000; // 每 ~6 秒推進一階段（封頂在最後一階段）

/** 讀檔 → dataUri。 */
function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** dataUri → HTMLImageElement（讀原始尺寸並畫進 canvas）。 */
function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUri;
  });
}

/** 讀檔 → 依長邊縮放 → 重新編碼成 JPEG dataUri。解碼失敗則退回原圖（後端仍有大小上限保底）。 */
async function downscaleImage(file: File, maxEdge = IMAGE_MAX_EDGE, quality = IMAGE_QUALITY): Promise<string> {
  const original = await readAsDataUri(file);
  try {
    const img = await loadImage(original);
    const { width, height } = img;
    if (!width || !height) return original;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return original;
  }
}

/**
 * DeckWizard — 三段 wizard 生成 deck（PROMPT 2）。
 * Step 1 方向與素材（含 從網址/PDF 匯入 → 灌 sourceText）；Step 2 受眾與風格（logo/參考圖/companyId）；Step 3 檢視生成。
 * 前後可切、保留已填。生成同步回 Deck（可能久 → loading 顯示階段/耗時/預估）。字串走 i18n（deckWizard.*）。
 */
export function DeckWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (deckId: string) => void }) {
  const t = useTranslations("deckWizard");
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [topic, setTopic] = useState("");
  const [pages, setPages] = useState(8);
  const [language, setLanguage] = useState<DeckLanguage>("zh-TW");
  const [objective, setObjective] = useState(""); // "" = 不指定；否則為 OBJECTIVE_KEYS 之一
  const [keyPoints, setKeyPoints] = useState("");
  const [metrics, setMetrics] = useState("");
  const [sourceText, setSourceText] = useState("");

  // Step 2
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [style, setStyle] = useState("");
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);
  const [refImageDataUris, setRefImageDataUris] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState("");

  // import + generate
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 生成中體驗：已耗時（秒）＋階段索引。generating 期間才計時，結束/取消歸零。
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      setPhase(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(Math.floor(ms / 1000));
      setPhase(Math.min(GEN_PHASE_KEYS.length - 1, Math.floor(ms / GEN_PHASE_STEP_MS)));
    }, 500);
    return () => clearInterval(id);
  }, [generating]);

  /** 換步驟時清掉殘留錯誤 banner（修跨步 stale：step1 匯入失敗的錯誤不該跟到 step2/3）。 */
  function goToStep(next: 1 | 2 | 3) {
    setError(null);
    setStep(next);
  }

  async function doImportUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const { text } = await extractUrl(importUrl.trim());
      setImportPreview(text);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("errFallbackUrl"));
    } finally {
      setImporting(false);
    }
  }

  async function doImportPdf(file: File) {
    setImporting(true);
    setError(null);
    try {
      const { text } = await extractPdf(file);
      setImportPreview(text);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("errFallbackPdf"));
    } finally {
      setImporting(false);
    }
  }

  function acceptImport() {
    if (importPreview == null) return;
    setSourceText((prev) => (prev ? `${prev}\n\n${importPreview}` : importPreview));
    setImportPreview(null);
    setImportUrl("");
  }

  async function doGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const input: GenerateDeckInput = {
        topic: topic.trim(),
        pages,
        language,
        objective: objective || undefined,
        keyPoints: splitLines(keyPoints),
        metrics: splitLines(metrics),
        audience: audience.trim() || undefined,
        tone: tone.trim() || undefined,
        style: style.trim() || undefined,
        logoDataUri,
        refImageDataUris: refImageDataUris.length ? refImageDataUris : undefined,
        sourceText: sourceText.trim() || undefined,
        companyId: companyId.trim() || undefined,
      };
      const deck = await generateDeck(input);
      onCreated(deck.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("errFallbackGen"));
      setGenerating(false);
    }
  }

  const canNext1 = topic.trim().length > 0 && pages >= MIN_DECK_PAGES && pages <= MAX_DECK_PAGES;
  const langShort = language === "zh-TW" ? t("summary.langZhShort") : t("summary.langEnShort");
  const keyPointsCount = splitLines(keyPoints)?.length ?? 0;

  return (
    <div className="mc-wizard" role="dialog" aria-modal="true" aria-label={t("ariaLabel")}>
      <div className="mc-wizard__panel">
        <header className="mc-wizard__head">
          <ol className="mc-stepper">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className={`mc-stepper__item ${step === n ? "is-on" : ""} ${step > n ? "is-done" : ""}`}>
                <span className="mc-stepper__num">{n}</span>
                <span className="mc-stepper__label">{t(`steps.s${n}`)}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="mc-iconbtn" aria-label={t("close")} onClick={onCancel}>
            ×
          </button>
        </header>

        {error ? <p className="mc-wizard__err" role="alert">{error}</p> : null}

        {step === 1 ? (
          <div className="mc-wizard__body">
            <label className="mc-field">
              <span>{t("topic")} *</span>
              <input className="mc-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("topicPlaceholder")} />
            </label>
            <div className="mc-blk__row">
              <label className="mc-field mc-field--grow">
                <span>{t("pages", { min: MIN_DECK_PAGES, max: MAX_DECK_PAGES })}</span>
                <input
                  className="mc-input mc-input--num"
                  type="number"
                  min={MIN_DECK_PAGES}
                  max={MAX_DECK_PAGES}
                  value={pages}
                  onChange={(e) => setPages(Math.max(MIN_DECK_PAGES, Math.min(MAX_DECK_PAGES, Number(e.target.value) || MIN_DECK_PAGES)))}
                />
              </label>
              <label className="mc-field mc-field--grow">
                <span>{t("language")}</span>
                <select className="mc-input" value={language} onChange={(e) => setLanguage(e.target.value as DeckLanguage)}>
                  <option value="zh-TW">{t("langZh")}</option>
                  <option value="en">{t("langEn")}</option>
                </select>
              </label>
            </div>
            <label className="mc-field">
              <span>{t("objective")}</span>
              <select className="mc-input" value={objective} onChange={(e) => setObjective(e.target.value)}>
                <option value="">{t("objectiveNone")}</option>
                {OBJECTIVE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`objectiveOptions.${k}.label`)}
                  </option>
                ))}
              </select>
              <span className="mc-field__hint">
                {objective ? t(`objectiveOptions.${objective}.desc`) : t("objectiveHintDefault")}
              </span>
            </label>
            <label className="mc-field">
              <span>{t("keyPoints")}</span>
              <span className="mc-field__hint">{t("keyPointsHint")}</span>
              <textarea className="mc-input mc-textarea" value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} />
            </label>
            <label className="mc-field">
              <span>{t("metrics")}</span>
              <span className="mc-field__hint">{t("metricsHint")}</span>
              <textarea className="mc-input mc-textarea" value={metrics} onChange={(e) => setMetrics(e.target.value)} />
            </label>

            <div className="mc-wizard__import">
              <p className="mc-wizard__importh">{t("importTitle")}</p>
              <div className="mc-blk__row">
                <input
                  className="mc-input"
                  placeholder={t("importUrlPlaceholder")}
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                />
                <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={doImportUrl} disabled={importing || !importUrl.trim()}>
                  {importing ? <Spinner size={13} /> : t("importFetch")}
                </button>
                <label className="mc-btn mc-btn--ghost mc-btn--sm mc-filebtn">
                  {t("importPdf")}
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void doImportPdf(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {importPreview != null ? (
                <div className="mc-wizard__preview">
                  <p className="mc-wizard__previewh">{t("previewTitle", { chars: importPreview.length })}</p>
                  <div className="mc-wizard__previewtext">{importPreview.slice(0, 1200)}{importPreview.length > 1200 ? "…" : ""}</div>
                  <div className="mc-wizard__previewacts">
                    <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setImportPreview(null)}>
                      {t("previewDiscard")}
                    </button>
                    <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={acceptImport}>
                      {t("previewAccept")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <label className="mc-field">
              <span>{t("sourceText")}</span>
              <span className="mc-field__hint">{t("sourceTextHint")}</span>
              <textarea className="mc-input mc-textarea mc-textarea--tall" value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mc-wizard__body">
            <label className="mc-field">
              <span>{t("audience")}</span>
              <span className="mc-field__hint">{t("audienceHint")}</span>
              <input className="mc-input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={t("audiencePlaceholder")} />
            </label>
            <div className="mc-blk__row">
              <label className="mc-field mc-field--grow">
                <span>{t("tone")}</span>
                <input className="mc-input" value={tone} onChange={(e) => setTone(e.target.value)} placeholder={t("tonePlaceholder")} />
              </label>
              <label className="mc-field mc-field--grow">
                <span>{t("style")}</span>
                <input className="mc-input" value={style} onChange={(e) => setStyle(e.target.value)} placeholder={t("stylePlaceholder")} />
              </label>
            </div>
            <label className="mc-field">
              <span>{t("companyId")}</span>
              <span className="mc-field__hint">{t("companyIdHint")}</span>
              <input className="mc-input" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder={t("companyIdPlaceholder")} />
            </label>
            <div className="mc-blk__row">
              <label className="mc-btn mc-btn--ghost mc-btn--sm mc-filebtn">
                {logoDataUri ? t("logoRepick") : t("logoPick")}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) setLogoDataUri(await downscaleImage(f));
                  }}
                />
              </label>
              <label className={`mc-btn mc-btn--ghost mc-btn--sm mc-filebtn${refImageDataUris.length >= MAX_REF_IMAGES ? " is-disabled" : ""}`}>
                {t("refAdd")}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  disabled={refImageDataUris.length >= MAX_REF_IMAGES}
                  onChange={async (e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    const room = MAX_REF_IMAGES - refImageDataUris.length;
                    if (room <= 0) return;
                    const uris = await Promise.all(picked.slice(0, room).map((f) => downscaleImage(f)));
                    setRefImageDataUris((prev) => [...prev, ...uris].slice(0, MAX_REF_IMAGES));
                  }}
                />
              </label>
              {refImageDataUris.length ? (
                <span className="mc-wizard__count">{t("refCount", { n: refImageDataUris.length, max: MAX_REF_IMAGES })}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mc-wizard__body">
            <div className="mc-wizard__summary">
              <SummaryRow label={t("summary.topic")} value={topic || t("summary.empty")} />
              <SummaryRow label={t("summary.pagesLang")} value={`${t("pagesUnit", { n: pages })} · ${langShort}`} />
              {objective ? <SummaryRow label={t("summary.objective")} value={t(`objectiveOptions.${objective}.label`)} /> : null}
              {keyPointsCount ? <SummaryRow label={t("summary.keyPoints")} value={t("summary.keyPointsCount", { n: keyPointsCount })} /> : null}
              {audience ? <SummaryRow label={t("summary.audience")} value={audience} /> : null}
              {companyId ? <SummaryRow label={t("summary.crm")} value={companyId} /> : null}
              {sourceText ? <SummaryRow label={t("summary.sourceText")} value={t("summary.sourceTextCount", { n: sourceText.length })} /> : null}
              {logoDataUri ? <SummaryRow label={t("summary.logo")} value={t("summary.logoAttached")} /> : null}
            </div>
            {generating ? (
              <div className="mc-wizard__gen">
                <Spinner size={20} />
                <div className="mc-wizard__geninfo">
                  <p className="mc-wizard__genphase">{t("generating.phasePrefix")}{t(`generating.${GEN_PHASE_KEYS[phase]}`)}…</p>
                  <div className="mc-wizard__genbar" aria-hidden="true">
                    {GEN_PHASE_KEYS.map((k, i) => (
                      <span key={k} className={`mc-wizard__genseg${i <= phase ? " is-on" : ""}`} />
                    ))}
                  </div>
                  <p className="mc-wizard__genmeta">
                    {t("generating.elapsed", { secs: elapsed })} · {t("generating.estimate")}
                  </p>
                  <p className="mc-wizard__gennote">{t("generating.note")}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <footer className="mc-wizard__foot">
          {step > 1 ? (
            <button type="button" className="mc-btn mc-btn--ghost" onClick={() => goToStep(step === 3 ? 2 : 1)} disabled={generating}>
              {t("back")}
            </button>
          ) : (
            <button type="button" className="mc-btn mc-btn--ghost" onClick={onCancel}>
              {t("cancel")}
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="mc-btn mc-btn--primary"
              onClick={() => goToStep(step === 1 ? 2 : 3)}
              disabled={step === 1 && !canNext1}
            >
              {t("next")}
            </button>
          ) : (
            <button type="button" className="mc-btn mc-btn--primary" onClick={doGenerate} disabled={generating || !topic.trim()}>
              {generating ? <Spinner size={14} /> : "✨"} {t("generate")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mc-wizard__srow">
      <span className="mc-wizard__slabel">{label}</span>
      <span className="mc-wizard__svalue">{value}</span>
    </div>
  );
}

/** 多行文字 → 去空白的陣列；空則 undefined（契約可選欄位）。 */
function splitLines(s: string): string[] | undefined {
  const arr = s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

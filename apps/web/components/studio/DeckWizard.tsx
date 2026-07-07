"use client";

import { useState } from "react";
import {
  MAX_DECK_PAGES,
  MIN_DECK_PAGES,
  type DeckLanguage,
  type GenerateDeckInput,
} from "@meetcopilot/shared";
import { ApiError, extractPdf, extractUrl, generateDeck } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

/**
 * DeckWizard — 三段 wizard 生成 deck（PROMPT 2）。
 * Step 1 方向與素材（含 從網址/PDF 匯入 → 灌 sourceText）；Step 2 受眾與風格（logo/參考圖/companyId）；Step 3 檢視生成。
 * 前後可切、保留已填。生成同步回 Deck（可能久 → loading）。
 */
export function DeckWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (deckId: string) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [topic, setTopic] = useState("");
  const [pages, setPages] = useState(8);
  const [language, setLanguage] = useState<DeckLanguage>("zh-TW");
  const [objective, setObjective] = useState("");
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

  async function doImportUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const { text } = await extractUrl(importUrl.trim());
      setImportPreview(text);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "網址匯入失敗");
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
      setError(err instanceof ApiError ? err.message : "PDF 匯入失敗");
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

  async function readAsDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
  }

  async function doGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const input: GenerateDeckInput = {
        topic: topic.trim(),
        pages,
        language,
        objective: objective.trim() || undefined,
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
      setError(err instanceof ApiError ? err.message : "生成失敗");
      setGenerating(false);
    }
  }

  const canNext1 = topic.trim().length > 0 && pages >= MIN_DECK_PAGES && pages <= MAX_DECK_PAGES;

  return (
    <div className="mc-wizard" role="dialog" aria-modal="true" aria-label="新建簡報">
      <div className="mc-wizard__panel">
        <header className="mc-wizard__head">
          <ol className="mc-stepper">
            {[1, 2, 3].map((n) => (
              <li key={n} className={`mc-stepper__item ${step === n ? "is-on" : ""} ${step > n ? "is-done" : ""}`}>
                <span className="mc-stepper__num">{n}</span>
                <span className="mc-stepper__label">{n === 1 ? "方向與素材" : n === 2 ? "受眾與風格" : "檢視生成"}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="mc-iconbtn" aria-label="關閉" onClick={onCancel}>
            ×
          </button>
        </header>

        {error ? <p className="mc-wizard__err" role="alert">{error}</p> : null}

        {step === 1 ? (
          <div className="mc-wizard__body">
            <label className="mc-field">
              <span>主題 *</span>
              <input className="mc-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例：Q3 產品提案給 Acme" />
            </label>
            <div className="mc-blk__row">
              <label className="mc-field mc-field--grow">
                <span>頁數（{MIN_DECK_PAGES}–{MAX_DECK_PAGES}）</span>
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
                <span>語言</span>
                <select className="mc-input" value={language} onChange={(e) => setLanguage(e.target.value as DeckLanguage)}>
                  <option value="zh-TW">繁體中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <label className="mc-field">
              <span>目標 objective（可空）</span>
              <input className="mc-input" value={objective} onChange={(e) => setObjective(e.target.value)} />
            </label>
            <label className="mc-field">
              <span>要點 keyPoints（一行一個，可空）</span>
              <textarea className="mc-input mc-textarea" value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} />
            </label>
            <label className="mc-field">
              <span>數據 metrics（一行一個，可空）</span>
              <textarea className="mc-input mc-textarea" value={metrics} onChange={(e) => setMetrics(e.target.value)} />
            </label>

            <div className="mc-wizard__import">
              <p className="mc-wizard__importh">從網址 / PDF 匯入素材（灌入下方來源文字）</p>
              <div className="mc-blk__row">
                <input
                  className="mc-input"
                  placeholder="https://example.com/article"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                />
                <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={doImportUrl} disabled={importing || !importUrl.trim()}>
                  {importing ? <Spinner size={13} /> : "抓取網址"}
                </button>
                <label className="mc-btn mc-btn--ghost mc-btn--sm mc-filebtn">
                  匯入 PDF
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
                  <p className="mc-wizard__previewh">抽取預覽（{importPreview.length} 字）</p>
                  <div className="mc-wizard__previewtext">{importPreview.slice(0, 1200)}{importPreview.length > 1200 ? "…" : ""}</div>
                  <div className="mc-wizard__previewacts">
                    <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setImportPreview(null)}>
                      捨棄
                    </button>
                    <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={acceptImport}>
                      灌入來源文字
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <label className="mc-field">
              <span>來源文字 sourceText（可貼長文，可空）</span>
              <textarea className="mc-input mc-textarea mc-textarea--tall" value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mc-wizard__body">
            <label className="mc-field">
              <span>受眾 audience（可空）</span>
              <input className="mc-input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="例：對方採購與技術主管" />
            </label>
            <div className="mc-blk__row">
              <label className="mc-field mc-field--grow">
                <span>語氣 tone（可空）</span>
                <input className="mc-input" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="專業 / 熱情…" />
              </label>
              <label className="mc-field mc-field--grow">
                <span>風格 style（可空）</span>
                <input className="mc-input" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="簡潔 / 資料密…" />
              </label>
            </div>
            <label className="mc-field">
              <span>綁定 CRM 公司 companyId（可空，供 grounding）</span>
              <input className="mc-input" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="UUID" />
            </label>
            <div className="mc-blk__row">
              <label className="mc-btn mc-btn--ghost mc-btn--sm mc-filebtn">
                {logoDataUri ? "已選 Logo（重選）" : "上傳 Logo"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setLogoDataUri(await readAsDataUri(f));
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="mc-btn mc-btn--ghost mc-btn--sm mc-filebtn">
                加入參考圖
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    const uris = await Promise.all(files.map(readAsDataUri));
                    setRefImageDataUris((prev) => [...prev, ...uris]);
                    e.target.value = "";
                  }}
                />
              </label>
              {refImageDataUris.length ? <span className="mc-wizard__count">參考圖 {refImageDataUris.length} 張</span> : null}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mc-wizard__body">
            <div className="mc-wizard__summary">
              <SummaryRow label="主題" value={topic || "（未填）"} />
              <SummaryRow label="頁數 / 語言" value={`${pages} 頁 · ${language === "zh-TW" ? "繁中" : "English"}`} />
              {objective ? <SummaryRow label="目標" value={objective} /> : null}
              {splitLines(keyPoints)?.length ? <SummaryRow label="要點" value={`${splitLines(keyPoints)!.length} 條`} /> : null}
              {audience ? <SummaryRow label="受眾" value={audience} /> : null}
              {companyId ? <SummaryRow label="CRM grounding" value={companyId} /> : null}
              {sourceText ? <SummaryRow label="來源文字" value={`${sourceText.length} 字`} /> : null}
              {logoDataUri ? <SummaryRow label="Logo" value="已附" /> : null}
            </div>
            {generating ? (
              <div className="mc-wizard__gen">
                <Spinner size={20} />
                <p>正在生成簡報…這可能需要一點時間，請稍候（生成期間別關閉本視窗）。</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <footer className="mc-wizard__foot">
          {step > 1 ? (
            <button type="button" className="mc-btn mc-btn--ghost" onClick={() => setStep((s) => (s === 3 ? 2 : 1))} disabled={generating}>
              上一步
            </button>
          ) : (
            <button type="button" className="mc-btn mc-btn--ghost" onClick={onCancel}>
              取消
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="mc-btn mc-btn--primary"
              onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              disabled={step === 1 && !canNext1}
            >
              下一步
            </button>
          ) : (
            <button type="button" className="mc-btn mc-btn--primary" onClick={doGenerate} disabled={generating || !topic.trim()}>
              {generating ? <Spinner size={14} /> : "✨"} 生成簡報
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

/**
 * Deck / DynamicSlide 契約型別（M2）。前後端共用的凍結接縫。
 * 唯一真相來源＝API_CONTRACT §4（wire 形狀）與 M234_CONTRACT §M2（007_decks.sql DDL）。
 * 命名：DB snake_case ↔ 此處 camelCase（repo 在邊界轉）；`*_json` 欄 → typed 物件；時間 epoch ms（number）。
 * SlideSpec / SlideSource / DeckLanguage / SlideTheme 沿用 slide-spec.ts（不重定義）。
 */
import type { SlideSpec, SlideSource, DeckLanguage, SlideTheme } from "./slide-spec.js";

// ─────────────────────────────────────────────────────────────
// DynamicSlide 匯入重構列舉（migration 018；契約 §1/§2）
// ─────────────────────────────────────────────────────────────

/**
 * deck 來源型別（decks.source_kind）：pptx/pdf 為匯入原檔；native＝AI 生成或無原檔的既有 deck。
 * 與既有 `source`（'ai'|'pptx'|'pdf'，來源管線）並存：native deck 走全 pptxgenjs 重建路徑，
 * pptx/pdf deck 保存原檔 bytes 供「原封匯出」。既有 deck 靠 migration DEFAULT 一律 'native'。
 */
export const DECK_SOURCE_KINDS = ["pptx", "pdf", "native"] as const;
export type DeckSourceKind = (typeof DECK_SOURCE_KINDS)[number];

/** deck 匯入狀態（decks.import_status）：轉檔背景 job 期間 'processing'；成功 'ready'；失敗 'failed'（+importError）。 */
export const DECK_IMPORT_STATUSES = ["processing", "ready", "failed"] as const;
export type DeckImportStatus = (typeof DECK_IMPORT_STATUSES)[number];

/**
 * deck 內單張頁的類別（deck_slides.kind）：'original'＝匯入原簡報的鎖定唯讀頁（前段 0..originalCount-1）；
 * 'spec'＝一般可編輯/append 的補充頁。既有 deck 靠 migration DEFAULT 一律 'spec'。
 */
export const DECK_SLIDE_KINDS = ["original", "spec"] as const;
export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number];

// ─────────────────────────────────────────────────────────────
// decks（007_decks.sql: decks；018 加匯入欄）
// ─────────────────────────────────────────────────────────────

/**
 * 一份簡報 deck（domain 實體）。
 * `committedIndex` 預設 -1（尚未開播）；live 中由 present 的 page_commit 單調遞增（I1 guard 依它）。
 * `source`＝deck 來源管線（ai 生成／pptx 匯入／pdf 匯入）。
 * 018 匯入重構新增：`sourceKind`（保存原檔的路徑分派）、`originalCount`（前段鎖定原始頁數）、
 * `importStatus`/`importError`（轉檔 job 進度）。既有 deck 靠 migration DEFAULT ＝ native/0/ready。
 */
export interface Deck {
  id: string;
  orgId: string;
  title: string;
  language: DeckLanguage; // 'zh-TW' | 'en'（CHECK）
  source: SlideSource; // 'ai' | 'pptx' | 'pdf'（CHECK）
  committedIndex: number; // 預設 -1
  companyId?: string; // nullable；供 CRM grounding
  theme?: SlideTheme; // theme_json
  /** 018：來源型別（保存/匯出路徑分派）。既有 deck ＝ 'native'。 */
  sourceKind: DeckSourceKind;
  /** 018：前段鎖定的原始頁數（isOriginal(i) = i < originalCount）。既有 deck ＝ 0。 */
  originalCount: number;
  /** 018：匯入轉檔狀態。既有 deck ＝ 'ready'。 */
  importStatus: DeckImportStatus;
  /** 018：failed 時的人話錯誤（其餘狀態 undefined）。 */
  importError?: string;
  createdAt: number;
  updatedAt: number;
}

/** deck 清單摘要（GET /api/decks → items）。 */
export interface DeckSummary {
  id: string;
  title: string;
  language: DeckLanguage;
  slideCount: number;
  updatedAt: number;
}

/**
 * GET /api/decks/:id 的 deck 子物件（wire 子集）。
 * 018：加 sourceKind/originalCount/importStatus/importError——前端據 originalCount 判定
 * `isOriginal(i) = i < originalCount`（唯一判定來源，不另傳 per-slide kind 給前端）。
 */
export interface DeckRef {
  id: string;
  title: string;
  language: DeckLanguage;
  committedIndex: number;
  sourceKind: DeckSourceKind;
  originalCount: number;
  importStatus: DeckImportStatus;
  importError?: string;
}

/** GET /api/decks/:id 回傳形狀：deck 頭 + 依 idx 排序的 slides。 */
export interface DeckView {
  deck: DeckRef;
  slides: SlideSpec[];
}

/** 建立 deck 輸入（id/orgId/committedIndex/簿記由 repo 生成）。generate/import 一次帶入整份 slides。 */
export interface NewDeck {
  title: string;
  language: DeckLanguage;
  source: SlideSource;
  companyId?: string;
  theme?: SlideTheme;
  /** 初始 slides（generate/import 產出的整份頁；純新建可省，之後以 appendSlide 長出）。 */
  slides?: SlideSpec[];
  /** 018 匯入：來源型別（缺省 'native'）。 */
  sourceKind?: DeckSourceKind;
  /** 018 匯入：指向 deck_assets 原檔 asset id（缺省 NULL）。 */
  sourceAssetId?: string;
  /** 018 匯入：初始匯入狀態（缺省 'ready'；匯入建 processing deck 時帶 'processing'）。 */
  importStatus?: DeckImportStatus;
  /** 018 匯入：初始原始頁數（缺省 0；轉檔完成後由 setOriginalCount 回填 N）。 */
  originalCount?: number;
}

// ─────────────────────────────────────────────────────────────
// deck_slides（007_decks.sql: deck_slides）
// ─────────────────────────────────────────────────────────────

/**
 * deck 內一張頁（domain 實體）。`idx`＝序（append 即 max(idx)+1）；`spec`＝spec_json（SlideSpec）。
 * I1（append-only）：新頁一律 appendSlide 到尾端；updateSlide 僅允許 idx > committedIndex（guard 在 route/realtime 層）。
 * 018：`kind`＝'original'（匯入原簡報鎖定唯讀頁）或 'spec'（一般補充頁）。既有頁 DEFAULT 'spec'。
 */
export interface DeckSlide {
  id: string;
  orgId: string;
  deckId: string;
  idx: number;
  spec: SlideSpec;
  createdAt: number;
  /** 018：頁類別。'original' 頁不可經 PATCH 編輯（repo guard → 409）。 */
  kind: DeckSlideKind;
}

// ─────────────────────────────────────────────────────────────
// deck_assets（migration 018；原檔 pptx/pdf bytes + 逐頁 page_image PNG bytes）
// domain 的二進位（bytes）型別住在 crm repo 層（Node Buffer）；此處只凍結 kind 列舉，避免把
// Node Buffer 型別洩進 wire/browser 契約層。
// ─────────────────────────────────────────────────────────────

/** deck_assets.kind：原檔（source_pptx/source_pdf）或逐頁點陣圖（page_image）。 */
export const DECK_ASSET_KINDS = ["source_pptx", "source_pdf", "page_image"] as const;
export type DeckAssetKind = (typeof DECK_ASSET_KINDS)[number];

// ─────────────────────────────────────────────────────────────
// import_jobs（migration 018；pptx/pdf → PNG 轉檔背景 job；複用 image_jobs 範式）
// ─────────────────────────────────────────────────────────────

/** 轉檔 job 狀態；boot reaper 把殘留 queued/running 一律標 failed（避免 Cloud Run 回收後卡死）。 */
export const IMPORT_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

// 註：轉檔 job 的 by-id 讀取形狀（ImportJob/ImportJobView）暫不需要——前端改輪詢 deck.importStatus
// （StudioView → getDeck），未建 GET /decks/import-jobs/:id。job 僅由 enqueue/setJobStatus/reaper 寫入簿記。

// ─────────────────────────────────────────────────────────────
// image_jobs（007_decks.sql: image_jobs；pre-meeting AI 生圖）
// ─────────────────────────────────────────────────────────────

/** 生圖 job 狀態＝型別唯一真相來源；`refused`＝內容審核拒絕（前端套 fallback 漸層）。對齊 API_CONTRACT §4。 */
export const IMAGE_JOB_STATUSES = ["queued", "running", "done", "failed", "refused"] as const;
export type ImageJobStatus = (typeof IMAGE_JOB_STATUSES)[number];

/** 生圖種類：背景圖或整頁圖。 */
export const IMAGE_KINDS = ["background", "full"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** 生圖 job（domain 實體）。 */
export interface ImageJob {
  id: string;
  orgId: string;
  deckId: string;
  slideIdx: number;
  kind: ImageKind;
  status: ImageJobStatus;
  prompt?: string;
  dataUri?: string; // done 時的 base64 png data: URI
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

/** GET /api/image-jobs/:id 回傳形狀（wire 子集）。 */
export interface ImageJobView {
  status: ImageJobStatus;
  dataUri?: string;
  error?: string;
}

/** 建立生圖 job 輸入（POST /api/decks/:id/image-jobs body ＋ deckId）。 */
export interface NewImageJob {
  deckId: string;
  slideIdx: number;
  kind: ImageKind;
  prompt?: string;
}

/** 生圖 job 局部更新（背景 worker：running/done+dataUri/refused/failed+error）。 */
export interface ImageJobUpdate {
  status?: ImageJobStatus;
  dataUri?: string;
  error?: string;
  finishedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// 生成 wizard 輸入（POST /api/decks/generate；沿 v1 wizard 契約，API_CONTRACT §4）
// ─────────────────────────────────────────────────────────────

/** 三段 wizard 生成 deck 的輸入。頁數上下限＝slide-spec 的 MIN/MAX_DECK_PAGES。 */
export interface GenerateDeckInput {
  topic: string;
  pages: number;
  language: DeckLanguage;
  objective?: string;
  keyPoints?: string[];
  metrics?: string[];
  audience?: string;
  tone?: string;
  style?: string;
  logoDataUri?: string;
  refImageDataUris?: string[];
  sourceText?: string;
  companyId?: string; // 綁定 CRM 公司做 grounding
}

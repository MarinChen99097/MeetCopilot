/**
 * Deck / DynamicSlide 契約型別（M2）。前後端共用的凍結接縫。
 * 唯一真相來源＝API_CONTRACT §4（wire 形狀）與 M234_CONTRACT §M2（007_decks.sql DDL）。
 * 命名：DB snake_case ↔ 此處 camelCase（repo 在邊界轉）；`*_json` 欄 → typed 物件；時間 epoch ms（number）。
 * SlideSpec / SlideSource / DeckLanguage / SlideTheme 沿用 slide-spec.ts（不重定義）。
 */
import type { SlideSpec, SlideSource, DeckLanguage, SlideTheme } from "./slide-spec.js";

// ─────────────────────────────────────────────────────────────
// decks（007_decks.sql: decks）
// ─────────────────────────────────────────────────────────────

/**
 * 一份簡報 deck（domain 實體）。
 * `committedIndex` 預設 -1（尚未開播）；live 中由 present 的 page_commit 單調遞增（I1 guard 依它）。
 * `source`＝deck 來源管線（ai 生成／pptx 匯入／pdf 匯入）。
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

/** GET /api/decks/:id 的 deck 子物件（wire 子集）。 */
export interface DeckRef {
  id: string;
  title: string;
  language: DeckLanguage;
  committedIndex: number;
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
}

// ─────────────────────────────────────────────────────────────
// deck_slides（007_decks.sql: deck_slides）
// ─────────────────────────────────────────────────────────────

/**
 * deck 內一張頁（domain 實體）。`idx`＝序（append 即 max(idx)+1）；`spec`＝spec_json（SlideSpec）。
 * I1（append-only）：新頁一律 appendSlide 到尾端；updateSlide 僅允許 idx > committedIndex（guard 在 route/realtime 層）。
 */
export interface DeckSlide {
  id: string;
  orgId: string;
  deckId: string;
  idx: number;
  spec: SlideSpec;
  createdAt: number;
}

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

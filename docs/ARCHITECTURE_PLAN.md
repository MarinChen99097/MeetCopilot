# 架構與里程碑計畫書：MeetCopilot v2

> **這是給後續（較弱）模型執行的計畫書。** 照里程碑 M0→M5 推進；每個里程碑有明確範圍＋**可測驗收條件**。
> 先讀 [00-DECISIONS.md](00-DECISIONS.md)（已拍板前提）→ [PRODUCT_SPEC.md](PRODUCT_SPEC.md)（做什麼）→ [research/API_FINDINGS.md](research/API_FINDINGS.md)（API 事實，不能猜）→ [CRM_SCHEMA.md](CRM_SCHEMA.md)（資料）。
> 派工照 [MODEL_DISPATCH.md](MODEL_DISPATCH.md) 與 [TASK_TEMPLATES.md](TASK_TEMPLATES.md)；判斷照 [JUDGMENT_RUBRICS.md](JUDGMENT_RUBRICS.md)。

---

## 1. 技術棧（同棧重寫；model ID 皆 2026-07-06 查證）

| 層 | 選型 | 備註 |
|---|---|---|
| 前端 | Next.js 15 App Router、next-intl（zh-TW/en）、**純 CSS**（無 Tailwind） | 沿用 v1；UI 語言≠內容語言分離 |
| 後端 | Node + Express + `ws`（WebSocket） | REST + WS；WS 走音訊/即時訊號 |
| DB | **better-sqlite3 + repository 層**（DbPort 抽象） | 日後換 Postgres/pgvector 不動業務碼（CRM_SCHEMA §10） |
| LLM（文字/分析/生成） | Gemini `@google/genai`，`gemini-3.1-flash-lite`（沿用 v1 統一） | JSON mode + responseSchema（union-superset，見 v1 教訓 L 空白頁 bug） |
| Embedding | `gemini-embedding-001` | JS cosine，藏在 EmbeddingRepository |
| 會議 ASR | Gemini 分段轉寫，藏在 `AsrProvider` 介面後 | **不用 Live API**（API_FINDINGS §A1/§D）；diarization 交下游 LLM |
| 模擬訓練語音 | **Gemini Live API** `gemini-3.1-flash-live-preview` | 瀏覽器經 ephemeral token 直連；長對練開 compression+resumption（§A） |
| AI 生圖 | `gemini-3.1-flash-image`（背景）/ `gemini-3-pro-image`（整頁含中文字） | **一律 pre-meeting**；被擋 fallback 漸層（§C） |
| 研究/爬蟲 | Gemini Search grounding + Playwright(+stealth) 自建爬蟲 + v1 SSRF-safe 抽取器 | SSRF 檢查掛在首次 fetch（§PRODUCT_SPEC 核心） |
| Auth | 自建 JWT（沿用 v1，JWT_SECRET fail-fast） | |
| 打包 | 先 `npm run dev` 本機跑；架構留雲端路 | 不寫死 localhost |

**環境**：Windows 11 + PowerShell 5.1（`&&` 不可用）+ Bash 工具。寫檔一律 Write/Edit（PS 5.1 UTF-16 會亂碼）。v2 已 git init（主要備份）。

---

## 2. Monorepo 結構（npm workspaces）

```
MeetCopilot_v2/
├─ packages/
│  ├─ shared/            # 契約：slide-spec、protocol(WS msgs)、signals、crm domain types、trust-rule 純函式
│  └─ crm/               # ★新核心：DbPort、repositories(介面+SqliteImpl)、migrations、embeddings、provenance
├─ apps/
│  ├─ server/            # Express + ws；REST + WS；模組見 §3
│  └─ web/               # Next.js；三個 surface：/crm、/studio(DynamicSlide)、/copilot、/train
├─ docs/                 # 本計畫書 + 制度檔
└─ (無 desktop —— 決策：純網頁)
```

> v1 舊碼在 `c:/Users/Martin/Desktop/MeetCopilot`，可當參考件直接借（slide-spec、patch-service、gemini client、SSRF extractor、pptx export、wizard、slide renderer/chart/icons、CSS）。**借碼＝讀 v1、在 v2 重寫對齊新契約**，不是 symlink。

---

## 3. 後端模組地圖（apps/server）

| 模組 | 職責 | 借自 v1？ |
|---|---|---|
| `auth/` | JWT、register/login、org/membership | 借（含 JWT fail-fast 修正） |
| `crm/` (用 packages/crm) | CRM CRUD、provenance、檢索 | 新 |
| `research/` | grounding 研究 + 爬蟲編排 + upsertFromCrawl；自動/手動觸發 | 部分借（SSRF extractor） |
| `import/` | 網址/PDF 抽取（SSRF-safe）+ Playwright 渲染爬蟲 | 借 + 擴充（Playwright） |
| `generation/` | slide-spec 生成（CSS 路徑）+ 生圖（pre-meeting）+ 自動 QA | 借（BLOCK_SCHEMA、sanitize、QA、DESIGN_PRINCIPLES） |
| `decks/` | deck CRUD、匯入、匯出 pptx、生成路由 | 借（含 pptx export、RFC5987 header 修正） |
| `realtime/` | WS：擷取 ingest、ASR、分析、訊號、改造引擎、approval FSM | 借（patch-service I1/I2 guard、presenter authz） |
| `asr/` | `AsrProvider` 介面 + Gemini 分段轉寫 impl | 借 |
| `analysis/` | rolling window 增量分析 → 結構化訊號 | 借（含 unhandledRejection guard） |
| `train/` | 模擬訓練：ephemeral token 發放、persona seed builder、評分 | 新 |
| `gemini.ts` | generateJson（多模態）+ generateImage + live token | 借 + 擴充 |

**改造引擎 op（I1）**：`type PatchOp = { kind:'APPEND'; slide } | { kind:'REORDER'; fromIndex; toIndex }`（皆須 index > committedIndex；移除 v1 的 INSERT_AFTER/REPLACE 中段操作）。

---

## 4. 前端 surface（apps/web）

| 路由 | Surface | 內容 |
|---|---|---|
| `/[locale]/crm` | CRM 管理 | 公司/主管清單+詳情、**確認/細填** provenance UI、爬蟲 enrich 觸發、crawl_jobs 狀態 |
| `/[locale]/studio` | DynamicSlide 編輯 | 三段 wizard（借 v1）、slide 編輯、pptx 匯出、pre-meeting 生圖 |
| `/[locale]/present` | 播放視圖 | **零 HUD** 的乾淨舞台（帳號 A 分享此分頁） |
| `/[locale]/copilot` | 會中副駕擷取端 | 帳號 B 開；「開始聆聽」擷取 Meet 分頁、送 ASR；本身極簡（非 HUD） |
| `/[locale]/hud` | HUD（第二裝置 responsive） | 建議/研究卡/逐字稿、A/S 接受略過、「深查」鈕 |
| `/[locale]/train` | 模擬訓練 | 選 contact persona、語音對練（Live 直連）、課後評分 |

> **I3 落點**：`/present` 元件樹**不得** import 任何 HUD/建議/逐字稿元件（加一條測試斷言）。`/copilot`（擷取端）與 `/hud`（檢視端）是同一 session 的不同 client。

---

## 5. Spike（動工前先驗；失敗要回頭重議）

**不變量從 M1 起生效**，但 spike 是驗「地基假設成不成立」，排在 M0 內或平行。

| # | Spike | 驗什麼 | 失敗的話 |
|---|---|---|---|
| **S1** | 雙帳號擷取 Meet 分頁音訊 | 真實 setup：B profile 開 Meet 分頁+Copilot 分頁，getDisplayMedia 拿到含 A 的混音；zero-track 守衛；AudioWorklet 出 16k PCM | 音訊模型的地基不成立 → 回頭與使用者重議（擴充？改 Meet bot？） |
| **S2** | Gemini 分段轉寫中英混合會議音訊 | ASR 品質/延遲可用；下游 LLM 能從逐字稿推斷 speaker（presenter/client） | 換 Google STT v2（AsrProvider 換 impl） |
| **S3** | Gemini Live 語音對練 | ephemeral token 瀏覽器直連、persona system prompt、打斷、逐字稿；>15min 用 compression+resumption | 退回 ASR+文字LLM+TTS 拼裝（train 抽象層留好） |
| **S4** | Playwright 爬蟲 + SSRF | Playwright+stealth 渲染對方官網、子頁爬取、SSRF 檢查擋內網（含雲端 metadata）、外網通 | 退回純 grounding + v1 undici 單頁抽取（能力降但可用） |
| **S5** | 生圖中文品質 + 延遲 | `gemini-3-pro-image` 中文 in-image 字可讀；`flash-image` 背景圖延遲；確認「不進會中」 | 只做背景圖+CSS 疊層路徑（放棄整頁生圖） |

> 每個 spike 派 fresh-context agent 實測（read-back / 跑真 API），主線只收結論＋`檔案:行號`（指揮官不下場）。S1、S3 是最高風險（新能力），優先。

---

## 6. 里程碑（M0→M5，含驗收條件）

> 驗收條件 = 「宣稱完成前，派 fresh-context agent 做 read-back 或跑測試」通過的可測項（硬規則 5：驗證不自驗）。
> 決策：**M2 起三條產品線並行**（DynamicSlide / 會中副駕 / 模擬訓練）；並行派工照 TASK_TEMPLATES 的契約鎖定守則（v1 L5 教訓：平行 agent 契約漂移）。

### M0 — 地基
**範圍**：monorepo（workspaces）、packages/shared 契約（slide-spec append-only、protocol、signals、crm domain types、trust-rule 純函式）、packages/crm（DbPort、migration runner + schema_migrations、base repository org-scoping）、auth（JWT + org/membership，含 fail-fast）、i18n 骨架、gemini client、.env(GEMINI_API_KEY) + config。**平行跑 S1、S3、S4。**
**驗收**：
- `npm install` + 三 workspace typecheck 全綠。
- migration runner 建出 §2 租戶表；base repo 的 CRUD 冒煙（含跨 org 讀被 org_id-scope 擋）。
- auth register/login 冒煙（含錯誤 JWT_SECRET fail-fast）。
- S1/S3/S4 至少 S1 有結論（成/敗）；敗則停下問使用者。

### M1 — CRM ＋ 研究引擎（新核心）
**範圍**：CRM 全 schema（CRM_SCHEMA §4–8）+ repositories（含 `upsertFromCrawl` 值+provenance 同 tx、`findByDomain` dedupe）；provenance「確認/細填」寫入語意；研究引擎（grounding + Playwright 爬蟲 + SSRF 首次 fetch 檢查 + crawl_jobs）；embeddings + profile_cards + JS cosine 檢索；CRM 前端（清單/詳情/確認細填/enrich 觸發）。
**驗收**：
- 給一個對方公司網域 → 爬蟲填出 companies + contacts 多欄 + provenance rows（filled_by=crawler + source_url），UI 顯示可「確認/細填」。
- SSRF：內網/雲端 metadata（169.254.169.254、100.100.100.200）被擋、外網通（fresh agent 實測，如 v1）。
- 檢索：對某公司組 query → 只回該公司+其 contacts+news+product/competitor cards（org-scoped + 白名單），不洩其他公司。
- trust-rule 純函式：human/verified 值權重壓過 crawler（單元測試）。

### M2 — DynamicSlide（產品線 A，與 B/C 並行）
**範圍**：slide-spec 生成（CSS 路徑，借 v1 生成器+QA+DESIGN_PRINCIPLES）、三段 wizard（借 v1）、pptx 匯出（借 v1）、pre-meeting 生圖（背景圖+CSS 疊層 / 整頁生圖，含 fallback）、改造引擎 **append-only**（I1 guard）、approval FSM（I2）、`/present` 零-HUD 播放視圖。
**驗收**：
- 生成 deck 0 空白頁、合法可下載 pptx（沿用 v1 e2e）。
- pre-meeting 生圖：背景圖產出 + 被安全擋時 fallback 漸層（不出壞頁）。
- I1：改造引擎對「非 append / index≤committed」op reject（攻擊測試）。
- I3：測試斷言 `/present` 元件樹不含 HUD/逐字稿元件。

### M3 — 會中副駕（產品線 B，與 A/C 並行）
**範圍**：realtime WS（擷取 ingest、AsrProvider、analysis 增量訊號、改造引擎、approval）、CRM 檢索接會中訊號、HUD（第二裝置 responsive，A/S 接受略過 + 深查鈕）、自動+手動研究觸發（每場上限）、presenter authz（借 v1 修正）。
**驗收**：
- 假音訊/逐字稿注入 → 訊號產出 → HUD 浮出對方公司/主管卡 + battlecard + objection handler（< 2s 目標，實測記錄）。
- 會中研究：偵測新人名 → 自動 crawl_job（受上限）；HUD「深查」手動觸發。
- I2 攻擊：非 presenter 憑證送 accept/page_commit → 被拒（用攻擊者憑證測，v1 L 教訓）。
- I3：HUD 內容不出現在 `/present`（雙帳號隔離 + 元件樹斷言）。

### M4 — 模擬訓練（產品線 C，與 A/B 並行）
**範圍**：train 模組（ephemeral token 發放、persona seed builder 由 CRM verified 欄位、Live 直連、compression+resumption）、`/train` 語音 UI（AudioWorklet 送 16k、播 24k、打斷）、課後評分（用雙向逐字稿）。
**驗收**：
- 選一個 verified persona → 語音對練，AI 用該 persona 語氣/hot_buttons 回應、可打斷；>15min 不斷線（compression+resumption 生效）。
- 評分報告涵蓋異議處理/需求發現/成交訊號（用逐字稿，fresh agent 檢查合理性）。
- 只用 verified/會議衍生 persona 欄位（不幻想爬蟲猜測——查 seed builder 只讀 verified）。

### M5 — 整合、隱私強化、成本、審查
**範圍**：三線整合冒煙（會前 CRM→模擬訓練→會中副駕+DynamicSlide→會後回寫 CRM 全鏈路）、PII 遮蔽、TTL、成本記帳（Gemini usage 冪等，借 v1）、CSP/sanitize、/code-review + /simplify。
**驗收**：
- 全鏈路 e2e：建公司→爬蟲填→確認→(選)對練→會中擷取假音訊→訊號→新頁批准 append→會後訊號回寫 contact objections（經批准）。
- code-review 多鏡頭對抗式（含 SSRF、authz、org 隔離、I1/I2/I3 未削弱、Live token 不洩、生圖 fallback）findings 全修。
- simplify 4 角度、typecheck + e2e 全綠、無回歸。

---

## 7. 橫切紀律（每個里程碑都遵守）

- **指揮官不下場**：讀 3+ 檔/掃目錄/跑驗證 → 派便宜 subagent（haiku/sonnet），主線只收結論＋`檔案:行號`。制度檔（docs/）親自讀不違反。
- **隨做隨存**：每完成一項 commit（git 是主要備份）；跨 session 狀態寫 WORKLOG.md。
- **驗證不自驗**：宣稱完成前派 fresh-context agent read-back / 跑測試。
- **平行派工契約鎖定**（v1 L5）：並行 agent 前先把共用契約（slide-spec、protocol、crm types）定死並凍結，各 agent 只實作不改契約；整合時驗契約一致（v1 踩過前後端契約漂移）。
- **授權用攻擊者憑證測**（v1 L）：I2/authz 用「非 presenter / 跨 org」憑證測被拒，不是只測正路。
- **schema 用 union-superset**（v1 空白頁 bug）：Gemini responseSchema 的 block/物件用「type 必填當判別、其餘 optional」超集，避免嚴格結構化輸出丟未宣告欄位。
- **只測一邊≠整合驗證**（v1 L）：前後端契約改動要端到端打通，不是只冒煙 server。
- **警訊先讀地面真相**（v1 L9/R7）：判斷前先查 DB/實際回應，不憑截圖/顯示名。

## 8. 已知風險與待決（誠實揭露）

- **S1 同瀏覽器約束**：雙帳號需 B 的 Meet 分頁+Copilot 分頁同 profile；使用者實戰 setup 要教學（可能需一頁操作指南）。
- **只 Chromium 桌面**（接收端）：Firefox/Safari/行動不支援擷取——硬約束，M0 要向使用者再確認可接受。
- **混音無乾淨分軌**：speaker 靠 LLM 推斷，準確度未知（S2 驗）。
- **會中研究成本/合規**：自動爬對方主管有成本與合規邊界；每場上限 + 只公開資訊 + provenance；合規責任在使用者。
- **Live API 配額**：並發上限依 tier，M4 前查配額頁。
- **生圖會前預生**：會中不即時整頁生圖；若使用者要「會中即時視覺頁」需另議（只能 1K flash-lite 背景 + 嚴格逾時 + fallback）。

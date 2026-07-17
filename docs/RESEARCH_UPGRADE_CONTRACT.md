# RESEARCH_UPGRADE_CONTRACT v1.0（2026-07-13 凍結）

> 爬蟲專輪四工作包的**凍結契約**：社群來源（WP1）／筆記區（WP2）／深廣預算（WP3）／會中 CRM 消費（WP4）。
> 依據：使用者 2026-07-13 四指示＋兩拍板（ROM 10:33、10:48）；4 路偵察報告 `C:\tmp\meetcopilot-social-recon\{engine,crm,meeting}.md`＋`docs/research/SOCIAL_CRAWL_FINDINGS.md`。
> **實作規則**：三個實作 agent（R＝server research、M＝server realtime、W＝web）只實作、不改契約；
> 契約與偵察報告衝突時**以本檔為準**；本檔沒定的細節照 repo 既有慣例；發現缺漏回報 gap，不得自創欄位/路徑/env 名。

## 0. 檔案所有權（防平行衝突，硬邊界）

| Agent | 專屬可改 | 明確禁改 |
|---|---|---|
| **R** | `apps/server/src/research/**`、`apps/server/src/config.ts`、`migrations/013_*`＋`migrations-pg/013_*`（雙套）、notes 單例 upsert（repos-pipeline）、`companies.social_links` 落庫（repos-prospect）、`DEPLOY.md`（僅加註記）、routes 的 `/reindex` 端點 | `realtime/**`、protocol、`apps/web/**` |
| **M** | `apps/server/src/realtime/**`、protocol 型別檔（transcript/InfoCard 所在檔，含 signals 定義） | `research/**`、`config.ts`（缺 env 回報 gap）、`apps/web/**` |
| **W** | `apps/web/**` | `apps/server/**`、packages 型別檔（缺型別回報 gap） |

三方都要：改程式檔後照 `docs/CHANGE_TRACKER.md` 追加紀錄（錨點插入，嚴禁 Write 覆寫；若遇 Edit 衝突先重讀再插）。

## 1. WP1 社群來源層（owner：R）

### 1.1 統一產物
所有社群內容一律化為既有 `SourceText`（deep-research.ts:49-56 之形狀），注入 `DeepResearchBundle.sourceTexts`，自動繼承 [S#]→真實 URL provenance。**不新造 provenance 機制。**

### 1.2 帳號發現（handles discovery）
- 官網爬取時從 `<a href>` 抽社群連結（facebook.com / instagram.com / threads.net|threads.com / youtube.com|youtu.be 網域 regex，去重、正規化為 handle 或 URL）。
- deep 研究查詢集加一條「official social media accounts」grounding 查詢，補官網沒掛的帳號。
- 落庫：`companies.social_links`（migration 013，TEXT，JSON 形狀 `{"youtube"?,"facebook"?,"instagram"?,"threads"?}`，值＝完整 URL）。sqlite＋pg 雙套 migration、boot 自動套用照既有慣例；provenance 照 `field_provenance` 慣例記 filledBy='crawler'。

### 1.3 各平台取得路徑（使用者拍板，不得改道）
| 平台 | 路徑 | 實作 |
|---|---|---|
| YouTube | **官方 Data API v3**（env `YOUTUBE_API_KEY`，缺→整平台 skip＋job log 一次性 warning，不算失敗） | 解析頻道（handle 或 search）→ `channels.list`（訂閱數/描述/影片數）→ 近期上傳 ≤30 支（`playlistItems`+`videos.list`：標題/描述/日期/觀看數）→ 產 SourceText（頻道總覽 1 則＋每支影片 1 則，URL＝真實影片/頻道網址） |
| Threads | **自建無登入 Playwright** 爬公開 profile/貼文頁（資料在頁內 `<script>` JSON） | 走既有 SSRF-safe crawler 路徑；≤30 則貼文；解析失敗→skip＋log，不得讓整個 job 失敗 |
| FB／IG | **只用 Gemini grounding**（不做 fetcher、不接第三方、不自爬） | deep 研究查詢集加「社群模板」≥6 條雙語（例：`site:facebook.com "<公司>"`、`"<公司>" Instagram 近期貼文/活動`、`"<公司>" 粉絲專頁 評價/口碑`、招聘/徵才動態），結果照現行 grounding 來源處理 |

### 1.4 介面（R 內部，凍結命名）
```ts
// apps/server/src/research/social/types.ts
export interface SocialFetchInput { companyName: string; domain?: string; handles: SocialHandles }
export type SocialHandles = { youtube?: string; facebook?: string; instagram?: string; threads?: string }
export interface SocialFetcher {
  platform: 'youtube' | 'threads'
  fetch(input: SocialFetchInput, ctx: { signal: AbortSignal; budgetMs: number; log: (m: string) => void }): Promise<SourceText[]>
}
```
合流點＝`runDeep`（orchestrator.ts:381 一帶）：社群 fetch 與 DeepResearcher∥官網爬蟲並行，總預算 `SOCIAL_FETCH_BUDGET_MS`。

## 2. WP2 筆記區（owner：R；前端 W）

- **沿用多型 `notes` 表**（migration 005:148，body markdown），不開新表。
- 每公司兩個**單例** AI 筆記（冪等鍵＝`(org_id, entity_type='company', entity_id, note_type)`，存在則更新 body/updated_at，**不重複建**；repos-pipeline 新增 `upsertSingletonNote` 方法）：
  1. `note_type='narrative'`，title `AI 敘事：公司型態與狀況`，pinned；body＝zh-TW 平鋪直敘 markdown 8–20 句（專有名詞保留原文），綜述公司型態、商業模式、近況、社群聲量與氛圍。
  2. `note_type='observations'`，title `未歸類情報`；body＝markdown bullet list ≤25 條，**每條句尾附來源連結**（`[來源](url)`，url 來自 [S#] 對映）。
- extractor＋deep-extractor 的 responseSchema 新增：`narrativeZh: string`、`uncategorized: [{ text: string, sourceIndex: number }]`（≤25）；SYSTEM prompt 明令：**凡重要但歸類不進既有欄位的情報一律進 uncategorized，不准丟棄**。
- W：NotesTab 把 pinned narrative 置頂顯示（沿用既有 note 卡樣式即可）。

## 3. WP3 深廣預算（owner：R；UI 由 W）

env 全部由 R 改 `config.ts`（預設值凍結如下，皆可 env 覆寫）：

| env | 舊預設 | 新預設 |
|---|---|---|
| `CRAWL_HARD_CAP_MS` | 300000 | **1800000**（30 min） |
| `MAX_CRAWL_PAGES` | 28 | **150** |
| `MAX_CRAWL_DEPTH` | 2 | **3** |
| `DEEP_RESEARCH_BUDGET_MS` | 150000 | **1200000**（20 min） |
| `RESEARCH_JOB_TIMEOUT_MS` | 600000 | **3600000**（60 min） |
| `DEEP_RESEARCH_ROUNDS`（新） | — | **3** |
| `SOCIAL_FETCH_BUDGET_MS`（新） | — | **600000**（10 min，四平台合計） |

- **多輪迭代**：round 1＝現行查詢集＋社群模板 → 擷取後做缺口分析（哪些欄位仍空/薄、哪些主題只有單一來源）→ 產 follow-up 查詢 → round 2/3；**一輪無新增事實即提早停**。每輪結束更新 crawl_jobs 進度（admin job 監控可見階段）。
- 所有 Gemini 呼叫一律走既有 metered wrapper（admin 記帳），不得繞過。
- **UI（W）**：EnrichPanel 移除「快速／標準」選項，只留單一「深度研究（全網＋社群）」入口＋「可能需要 30–60 分鐘」提示；standard 模式程式保留（URL 匯入內部使用），不再出現在研究 UI。
- **R 在 `DEPLOY.md` 加註記**（僅文字）：長 job 需 Cloud Run CPU always-allocated（`--no-cpu-throttling`）否則回應結束後 job 停擺；本輪不改部署，部署時處理。

## 4. WP4 嵌入管線與會中消費（索引＝R；消費＝M；顯示＝W）

### 4.1 建索引（R）
- 新模組 `apps/server/src/research/indexer.ts`：`buildCompanyIndex(orgId, companyId)`——chunk 來源＝companies(description/_zh＋narrative note)、contacts、company_products、company_news、兩單例筆記；每 chunk ≤約 1000 字元；`embeddings` repo 冪等 upsert（鍵含 entity_type/entity_id/chunk 序）。
- 呼叫點：`runJob`（standard 與 deep）成功收尾後；另開 `POST /api/companies/:id/reindex`（授權同 enrich 端點；**org 隔離，非成員 403**）。

### 4.2 會中檢索與卡片（M）
- `realtime/retrieval.ts` 白名單擴大：現行 {company, contacts, deal} → 加 **notes、company_products、company_news** 的 entity id（org 檢查照舊嚴格）。
- 觸發：沿用現行分析節流；每個分析窗把 signal label＋近期逐字稿要點做檢索，similarity 過門檻取 top3 → 產 InfoCard（**沿用既有 kind／trust 枚舉**：kind 依實體選 company/contact/battlecard 等既有值；trust＝provenance human→`verified`、否則 `crawler`）；**同場同 entity 去重**（一場會議同一實體只出一次卡）。
- `signals` 新增兩類：`person_mention`（提到人名）、`topic_shift`（話題轉換），分析 prompt 同步更新；此兩類訊號觸發檢索但**不觸發**自動研究 job（自動研究觸發條件不變）。
- 說話者升級：wire 欄位 `speaker` 枚舉**不變**（presenter/client/unknown，向後相容）；transcript payload 加**選填** `speakerLabel?: string`（例「客戶-A」「客戶-王經理」）——speaker 推斷 prompt 帶入該 meeting 對應公司的 CRM contacts 名單（姓名/職稱），LLM 依內容推斷是哪一位、雙方多人時以 A/B/C 區分。protocol 型別檔只由 M 改。

### 4.3 前端（W）
- HUD transcript：有 `speakerLabel` 就顯示（無則照舊 presenter/client）。
- InfoCardStream：確認 CRM 來源卡（含 sourceUrl、trust）渲染正常；毋須新卡型。

## 5. 安全與不變量（三方共同）

1. **I1/I2/I3 不觸及**：不動 deck patch／approval gate／播放視圖；新卡只進 HUD。
2. 新外呼（YouTube API、threads.net）走既有 SSRF-safe 路徑；禁止登入態爬取（決策）。
3. `/reindex` 必須以**攻擊者憑證**（跨 org、非成員）驗 403（L7）。
4. 秘密：`YOUTUBE_API_KEY` 只進 env（`.env.example` 補欄位），絕不落码/落庫/落 log。
5. 記帳：新增 LLM 呼叫全走 metered wrapper。

## 6. 驗收（整合後由 fresh-context 驗證 agent 執行）

- typecheck 全 workspace 綠；既有測試全綠（server 73+、CRM 46+）。
- 新測試：筆記單例冪等（跑兩次不重複）；indexer 冪等；多輪提早停；uncategorized 落 notes；白名單跨 org 拒絕；卡片去重；speakerLabel 選填相容。
- 端到端冒煙：對一家真公司跑 deep（含社群）→ notes 兩單例出現、social_links 落庫、embeddings 有列；模擬會中訊號 → 檢索回非空 → InfoCard 產出。
- 契約一致性：三方無自創欄位/路徑/env。

# M1 內部契約（CRM 全 schema＋研究引擎的凍結接縫）

> M1 平行實作的接縫凍結檔。DDL 真相在 `CRM_SCHEMA.md`（已完整）；本檔只定 **CRM_SCHEMA 沒明定、但平行 agent 必須一致的介面決策**（repository 方法簽名、研究引擎介面、provenance 語意的程式落點）。
> HTTP 形狀以 `API_CONTRACT.md` 為準。改接縫 → 先改本檔＋記 ROM。

## 1. packages/crm — domain types 與 repository 介面（擴充 ports.ts）

- **命名**：DB snake_case ↔ domain camelCase（repo 在邊界轉；service 不見 SQL/JSON 字串）。`*_json` 欄 → repo parse 成 typed 陣列/物件。時間 epoch ms（number）。
- **org-scoping 鐵律**：每個方法第一參數 `orgId: string`（除 user 全域查詢），內部注入 `WHERE org_id = ?`。
- **M0 seam gap 修復（本 M1 必做）**：`MembershipRepository` 加 `findPrimaryOrgOf(userId: string): Promise<{ orgId: string; role: Role } | null>`（回使用者最早加入的 org）；`apps/server/src/auth/routes.ts` 的 `findPrimaryMembership` direct-SQL shim **移除**、改呼叫它。

### 要新增的 repository（全部 `Sqlite*Repository` 實作 + 介面放 ports.ts）
```ts
interface CompanyRepository {
  create(orgId, input: NewCompany): Promise<Company>;
  findById(orgId, id): Promise<Company | null>;
  findByDomain(orgId, domain): Promise<Company | null>;          // 爬蟲 dedupe
  list(orgId, filter: {query?; status?; ownerUserId?}, page: {page; pageSize}): Promise<{items: CompanySummary[]; total: number}>;
  update(orgId, id, patch: Partial<Company>, by: {userId}): Promise<Company>;   // 細填：見 §3
  delete(orgId, id): Promise<void>;
  upsertFromCrawl(orgId, domain, crawled: CrawlPayload): Promise<Company>;      // 值+provenance 同一 tx，見 §3
  counts(orgId, id): Promise<{contacts; products; news; deals}>;
}
interface ContactRepository { /* 同型：create/findById/list(byCompany)/update/delete/upsertFromCrawl */ }
interface CompanyProductRepository { /* + listPeople/addPerson/removePerson（company_product_people join）*/ }
interface CompanyChildRepository { /* news/locations/funding/tech/departments 的 list + bulkUpsert（爬蟲寫入用）*/ }
interface DealRepository { /* CRUD + listContacts/addContact（buying committee）*/ }
interface NoteRepository { /* list(byEntity)/create/update/delete（多型 entityType+entityId）*/ }
interface ProvenanceRepository {
  listForEntity(orgId, entityType, entityId): Promise<FieldProvenance[]>;       // 每欄最新未 superseded
  confirm(orgId, entityType, entityId, fieldName, by: {userId}): Promise<void>; // verified=1
  record(orgId, rows: NewProvenance[]): Promise<void>;                          // 內部：crawl/human 寫入
}
interface EmbeddingRepository {
  upsert(orgId, rows: NewEmbedding[]): Promise<void>;                            // content_hash 去重
  search(orgId, queryVec: number[], filter: {entityTypes?: string[]; entityIds?: string[]}, k: number): Promise<{entityType; entityId; content; score}[]>;  // JS cosine
}
interface ProfileCardRepository { /* get/upsert(built_from_hash 守重生) */ }
```
- `CrmCore` 介面**加上這些 repository 欄位**；`createCrmCore` 一併組裝。
- **migrations 依 CRM_SCHEMA §12 順序**：`002_seller.sql`（seller_companies/products/competitors）→ `003_prospect.sql`（companies+子表 locations/news/funding/tech/**company_products/company_product_people/company_departments**）→ `004_contacts.sql` → `005_deals_meetings.sql`（deals/deal_contacts/deal_products/meetings/meeting_*/signals/notes/activities）→ `006_retrieval.sql`（field_provenance/embeddings/profile_cards/crawl_jobs）。每檔照 CRM_SCHEMA 的 DDL、無 FOREIGN KEY、org_id 全帶、index 齊。

## 2. 研究引擎介面（apps/server/src/research/ 與 import/）

```ts
// SSRF-safe 單頁抽取（借 v1 apps/server/src/import/extract.ts 的 undici DNS-pin 方案，整包移植）
interface SafeFetcher { extractFromUrl(url): Promise<{title?; text}>; extractFromPdf(buf): Promise<{text}>; }

// Playwright 渲染爬蟲（S4；SSRF 檢查掛在導航前＋page.route 逐請求，見 EZPAGESITE_CRAWLER）
interface CrawlProvider {
  crawl(opts: {url; mode: 'quick'|'detailed'; maxSubPages?: number}): Promise<RawCrawl>;   // 渲染+子頁+截圖(detailed)
}
// Gemini 把 RawCrawl → CRM 欄位（結構化抽取，union-superset schema 防空白，見 v1 教訓）
interface CrawlExtractor { toCompany(raw: RawCrawl): Promise<CrawlPayload>; toContacts(raw): Promise<Partial<Contact>[]>; }
// Gemini Google Search grounding（開放研究即答）
interface GroundingProvider { answer(query, ctx?: {companyId?}): Promise<{answer; citations:{title;url}[]}>; }

// 編排：POST /api/research/enrich → 建 crawl_job(queued) → 背景跑 crawl→extract→upsertFromCrawl(值+provenance) → job(done, fieldsFilled)
// 會中 quick 觸發同介面、mode:'quick'、受 RESEARCH_AUTO_LIMIT_PER_MEETING 上限。
```
- **SSRF 鐵律**：所有使用者提供 URL 的**首次 fetch＋每個子請求**都過 `isPrivateIp` 檢查（擋 loopback/私網/雲端 metadata 169.254.169.254 / 100.100.100.200）。Playwright 走 `page.route()` 攔截（undici DNS-pin 對它不適用）。
- crawl_job：`202 {jobId}` → `GET /api/research/jobs/:id` 輪詢（API_CONTRACT §3）。detailed 可長跑。

## 3. Provenance 語意（信任層的程式落點）

- **細填（human 覆寫）**＝`PATCH /api/crm/...`：repo `update()` 對**每個被改欄位**，除寫實體欄位外，`ProvenanceRepository.record` 插一列 `filled_by='human', verified=1`（隱含權威），舊列標 `superseded_by`；bump 實體 `verified_status`。全在一個 `tx`。
- **確認**＝`POST /api/crm/provenance/confirm`：`confirm()` 把該欄最新 provenance `verified=1`（值不變）。
- **爬蟲寫入**＝`upsertFromCrawl`：實體欄位 + `filled_by='crawler', source_url, confidence` provenance 列，**同一 tx**（值與 provenance 永不漂移）。
- **會議衍生回寫**（M3 用，本 M1 先留介面）：`filled_by='human', source_type='meeting', source_detail=meetingId, verified=1`。
- **信任規則**（`packages/shared/src/trust.ts` 已有 `isTrusted`）：副駕/trainer 取值前**逐欄**過 provenance（human 或 verified=1 才全信；否則標「據公開資訊」）。M1 的檢索 profile_card 組卡即套用。

## 4. CRM 成品前端（apps/web `/crm`；決策 20＝成品非佔位）

- 設計規格＝`FRONTEND_DESIGN_PROMPTS.md` PROMPT 0+1；資料介面＝`API_CONTRACT.md` §1–3。
- 必做：公司清單（搜尋/篩選/分頁）→ 詳情（tabs：總覽/人物/**產品深檔**/新聞/技術棧/部門/商機/筆記）；**每個爬蟲填的欄位帶 provenance 徽章（來源+信心+已驗?）＋「確認」鈕＋「細填」行內編輯**；「enrich」觸發 crawl_job＋進度；人物 persona 卡（decision_power/hot_buttons/objections）。
- 狀態三態（空/載入/錯誤）、job 進度（queued→running→done/failed）、WS 無關（CRM 純 REST）。
- API 呼叫走 `lib/api.ts`（不寫死 localhost）；元件狀態 props 化、可被設計視覺替換。

## 5. 驗收（M1，fresh-context agent 跑）
1. `npm run typecheck` 全 workspace 綠；crm 新測試綠（repo org-scoping、upsertFromCrawl 值+provenance 同 tx、cosine search 白名單）。
2. **爬一個真實公開公司網站**（agent 選一個穩定的，如某 SaaS 官網）→ companies+contacts 多欄填出＋provenance 列（filled_by=crawler+source_url），`GET /companies/:id` 看得到。
3. **SSRF**：`extractFromUrl`/crawler 對 `http://169.254.169.254/`、`http://localhost` 被擋；對外網公開頁通（複用 v1 驗法）。
4. **細填/確認**：PATCH 一個欄位 → provenance 出現 human 列且舊列 superseded；confirm → verified=1。
5. **檢索**：對某公司組 query → 只回該公司+其 contacts/products/news cards（org-scoped+白名單），不洩他司。
6. CRM 前端：`npm run build`（web）通過；/crm 清單與詳情實際打 server 顯示資料（可用 seed）；provenance 徽章與確認/細填動作可操作。
7. auth 的 direct-SQL shim 已移除（grep 確認 routes.ts 無 `core.db.get`）。

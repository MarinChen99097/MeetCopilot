# MeetCopilot v2 — CRM 資料 Schema 設計（SQLite / better-sqlite3 ＋ Repository 層）

> **狀態**：greenfield 實作用設計文件。這是**新核心**。來源＝研究工作流 `crm-schema` agent（2026-07-06），對齊 v1 慣例。
> 兩個消費端：(A) **會中副駕**（會中即時浮出對方公司＋主管的補充情報）、(B) **語音模擬訓練**（AI 扮演特定客戶對練）。
> Schema 刻意**欄位很多**，因為爬蟲先填大半、人再細填/驗證。

---

## 0. 全表通用慣例

| 面向 | 規則 |
|---|---|
| **主鍵** | `id TEXT PRIMARY KEY` — UUIDv7（可時間排序）。 |
| **租戶** | 每張業務表帶 `org_id TEXT NOT NULL`（denormalized）。每個 repository 方法都收 `orgId` 並注入 `WHERE org_id = ?`。**沒有 org_id 就不信任任何 id**。 |
| **時間** | `*_at INTEGER` ＝ epoch **毫秒**（UTC）。`created_at NOT NULL`，每次寫入 bump `updated_at`。 |
| **布林** | `INTEGER` 0/1（SQLite 無 bool）。 |
| **列舉** | `TEXT` ＋ `CHECK (col IN (...))`。可移植到 Postgres `TEXT`+`CHECK` 或原生 enum。 |
| **半結構化資料** | `TEXT` 存 **JSON**。Repository 在邊界 parse/serialize（domain 物件是 typed；DB 欄位在程式裡以 `_json` 結尾）。可移植到 Postgres `jsonb`。 |
| **要查詢/過濾的一對多** | 開真的子表（如 `company_news`），**不要**用 JSON。JSON 只給「總是整包讀」的陣列（如 `education`）。 |
| **Embedding** | `TEXT`（JSON `number[]`）＋ JS 暴力 cosine（如 v1）；同存 `dims`+`model`。日後可換 pgvector / `sqlite-vec`，藏在 repo 後面。 |
| **可填性標記** | **C**＝爬蟲可填 · **H**＝人細填/覆寫 · **S**＝系統管理 · **C+H**＝爬蟲先填、人驗證/覆寫。 |
| **來源溯源** | 爬蟲寫的值**不**在每欄加 `_source`/`_confidence`（欄位爆炸）。溯源集中在一張 `field_provenance` 表，key＝`(entity_type, entity_id, field_name)`。各表只帶粗略 rollup：`crawl_confidence`、`last_crawled_at`、`verified_status`。 |

---

## 1. 實體關係圖

```
orgs ─┬─ users ─ memberships
      │
      ├─ seller_companies ─ products ─┐
      │                               ├─ competitors (battlecards)
      │
      ├─ companies (對方公司, 可爬) ─┬─ company_locations
      │      │                        ├─ company_news
      │      │                        ├─ company_funding_rounds
      │      │                        └─ company_tech
      │      │
      │      ├─ contacts (主管, 可爬) ── (self-ref reports_to)
      │      │
      │      └─ deals ─┬─ deal_contacts (採購委員會)
      │                └─ deal_products
      │
      ├─ meetings ─┬─ meeting_attendees
      │            ├─ meeting_transcript_segments
      │            └─ meeting_signals
      │
      ├─ activities (時間軸: 通話/信件/任務)
      ├─ notes (多型自由筆記)
      │
      ├─ field_provenance   (每欄來源+信心+驗證)   ← 信任層
      ├─ embeddings         (profile card + chunk 的 RAG 索引) ← 檢索層
      ├─ profile_cards      (副駕與 UI 共用的衍生卡片文字)
      └─ crawl_jobs         (enrichment 執行追蹤)
```

---

## 2. 租戶與身分表（沿用 v1）

**`orgs`** — S：`id`, `name`, `default_locale TEXT DEFAULT 'zh-TW'`, `plan TEXT`, `created_at`。
**`users`** — S：`id`, `email UNIQUE`, `password_hash`, `display_name`, `locale`, `created_at`。
**`memberships`** — S：`(user_id, org_id)` PK, `role CHECK IN ('owner','admin','member')`, FK users/orgs，index `org_id`。

---

## 3. 賣方側 — rep 自己的公司與產品（多半人填、一次性設定）

### `seller_companies` — 賣方自家公司檔（通常每 org 1 筆；代理商可 N 筆）
| 欄位 | 型別 | Fill | 備註 |
|---|---|---|---|
| id / org_id | TEXT | S | FK orgs |
| name / legal_name | TEXT | C+H | 自家網站可爬但 rep 也知道 |
| domain | TEXT | H | |
| description | TEXT | H | 我們做什麼 |
| elevator_pitch | TEXT | H | 副駕可直接引用的 1–2 句 |
| mission / industry | TEXT | H | |
| icp_description | TEXT | H | 理想客戶輪廓（驅動 fit 評分） |
| target_personas_json | TEXT(JSON) | H | `[{persona,title,pains}]` |
| value_props_json / differentiators_json | TEXT(JSON) | H | 排序過的價值主張 / 差異化 |
| pricing_model | TEXT | H | seat/usage/flat |
| website_url / logo_url / default_language | TEXT | H | |
| created_at / updated_at | INTEGER | S | |

### `products` — 自家產品（副駕的「我們賣什麼」知識）
| 欄位 | 型別 | Fill | 備註 |
|---|---|---|---|
| id / org_id / seller_company_id | TEXT | S | FKs |
| name / category / one_liner / description | TEXT | H | |
| key_features_json | TEXT(JSON) | H | `[{name,benefit}]` |
| value_props_json / differentiators_json / use_cases_json / target_personas_json | TEXT(JSON) | H | |
| pricing_model / price_from / price_notes | TEXT/REAL/TEXT | H | |
| **objection_handlers_json** | TEXT(JSON) | H | `[{objection, response, proof}]` — **會中副駕高價值** |
| proof_points_json | TEXT(JSON) | H | 案例、數字、logo |
| competitor_ids_json | TEXT(JSON) | H | FK → competitors |
| status | TEXT CHECK('active','deprecated') | H | |
| created_at / updated_at | INTEGER | S | |

### `competitors` — battlecards（提到對手時副駕用）
`id, org_id`, `name/domain` (C+H), `positioning` (C+H), `strengths_json/weaknesses_json` (H), `our_advantages_json` (H, 我們怎麼贏), `landmines_json` (H, 對手設的陷阱), `pricing_notes` (C+H), `created_at/updated_at`。

---

## 4. 對方側 — `companies`（可爬的英雄表）

Firmographics ＋ 公開情報 ＋ 銷售管理欄位。刻意豐富。完整 DDL：

```sql
CREATE TABLE IF NOT EXISTS companies (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,                    -- S  FK orgs
  -- ── 身分 (C+H) ──
  name               TEXT NOT NULL,                    -- C+H 顯示名
  legal_name         TEXT,                             -- C
  aka_json           TEXT,                             -- C  舊名/別名 []
  domain             TEXT,                             -- C+H 主網域 (dedupe key)
  website_url        TEXT,                             -- C
  logo_url           TEXT,                             -- C
  description        TEXT,                             -- C+H 他們做什麼
  tagline            TEXT,                             -- C
  -- ── 分類 (C+H) ──
  industry           TEXT,                             -- C+H 主要垂直
  sub_industries_json TEXT,                            -- C
  naics_sic_json     TEXT,                             -- C  官方代碼
  business_model     TEXT,                             -- C+H B2B SaaS / marketplace / services
  keywords_json      TEXT,                             -- C  網站定位關鍵字
  -- ── 規模/財務 (C, 估計) ──
  founded_year       INTEGER,                          -- C
  ownership_type     TEXT,                             -- C+H public/private/pe/nonprofit/gov
  stock_ticker       TEXT,                             -- C
  employee_count     INTEGER,                          -- C  已知才填精確值
  employee_range     TEXT,                             -- C+H "51-200"
  employee_growth_yoy REAL,                            -- C  %
  annual_revenue     REAL,                             -- C+H 估計
  revenue_range      TEXT,                             -- C+H
  currency           TEXT,                             -- C
  funding_total      REAL,                             -- C
  funding_stage      TEXT,                             -- C  Seed/Series A/…/Public
  last_funding_at    INTEGER,                          -- C
  last_funding_amount REAL,                            -- C
  valuation          REAL,                             -- C
  investors_json     TEXT,                             -- C  (另見 funding_rounds 子表)
  -- ── 聯絡/社群 (C) ──
  hq_country TEXT, hq_region TEXT, hq_city TEXT, hq_address TEXT,  -- C (另見 company_locations)
  timezone           TEXT,                             -- C
  phone_main         TEXT,                             -- C
  email_general      TEXT,                             -- C  info@…
  social_linkedin TEXT, social_twitter TEXT, social_facebook TEXT,
  social_youtube TEXT, social_crunchbase TEXT, social_github TEXT, -- C
  languages_json     TEXT,                             -- C
  -- ── 副駕會浮出的公開情報 (C) ──
  products_offered_json TEXT,                          -- C  他們的產品/服務
  key_customers_json TEXT,                             -- C  官網上的客戶 logo
  certifications_json TEXT,                            -- C  SOC2/ISO/HIPAA
  awards_json        TEXT,                             -- C
  hiring_signals_json TEXT,                            -- C  在徵的職缺/部門 → 意向訊號
  recent_news_summary TEXT,                            -- C+H 從 company_news 匯總
  -- ── 銷售情報 (多半 H / 會議衍生) ──
  pain_points_json   TEXT,                             -- H (弱 C) 推測+確認
  strategic_initiatives_json TEXT,                     -- H/C  如「APAC 擴張」
  buying_triggers_json TEXT,                           -- H/C
  current_vendors_json TEXT,                           -- C+H 現有供應商(部分來自 tech)
  -- ── 帳戶管理 (H / S) ──
  fit_score          INTEGER,                          -- S/H  0-100 ICP fit
  fit_reasons_json   TEXT,                             -- S/H
  account_tier       TEXT,                             -- H  A/B/C
  account_status     TEXT,                             -- H  prospect/active/customer/churned
  lifecycle_stage    TEXT,                             -- H
  lead_source        TEXT,                             -- H
  owner_user_id      TEXT,                             -- H  FK users (帳戶負責人)
  -- ── 爬蟲簿記 (S) + 驗證 (H) ──
  source             TEXT,                             -- C+H crawler/import/manual
  crawl_confidence   REAL,                             -- S   粗略 rollup 0-1
  last_crawled_at    INTEGER,                          -- S
  last_enriched_at   INTEGER,                          -- S
  verified_status    TEXT DEFAULT 'none',              -- H   none/partial/verified
  verified_by        TEXT,                             -- H   FK users
  verified_at        INTEGER,                          -- H
  raw_crawl_json     TEXT,                             -- S   最近一次原始爬蟲 payload(可重處理)
  custom_fields_json TEXT,                             -- H   租戶自訂
  created_at         INTEGER NOT NULL,                 -- S
  updated_at         INTEGER NOT NULL,                 -- S
  CHECK (account_status IN ('prospect','active','customer','churned') OR account_status IS NULL),
  CHECK (verified_status IN ('none','partial','verified'))
);
CREATE INDEX IF NOT EXISTS idx_companies_org        ON companies(org_id);
CREATE INDEX IF NOT EXISTS idx_companies_org_domain ON companies(org_id, domain);
CREATE INDEX IF NOT EXISTS idx_companies_org_owner  ON companies(org_id, owner_user_id);
```

### 對方子表（皆可爬、皆可查）
- **`company_locations`** — C：`id, org_id, company_id`, `type CHECK('hq','office','branch','remote')`, `country, region, city, address, is_primary`。
- **`company_news`** — C（副駕最佳訊號之一）：`id, org_id, company_id, title, url, source, published_at INTEGER, summary, category CHECK('funding','product','exec_change','mna','partnership','legal','financial','other'), sentiment REAL, relevance REAL, embedded INTEGER`。Index `(org_id, company_id, published_at DESC)`。
- **`company_funding_rounds`** — C：`id, org_id, company_id, round_type, amount, currency, announced_at, lead_investor, investors_json, source_url`。
- **`company_tech`** — C（BuiltWith/Wappalyzer 風）：`id, org_id, company_id, category, vendor, product, detected_from, confidence REAL, first_seen_at, last_seen_at`。撐起「他們已用 X → 整合/替換切角」。

---

## 5. 對方側 — `contacts`（主管；可爬身分 ＋ 人填 persona）

副駕與模擬訓練最豐富的輸入。概念上分**公開/專業（可爬）** 與 **persona/關係（人填＋會議衍生）**。

```sql
CREATE TABLE IF NOT EXISTS contacts (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,                    -- S FK orgs
  company_id         TEXT NOT NULL,                    -- C+H FK companies
  -- ── 身分 (C) ──
  full_name          TEXT NOT NULL,                    -- C+H
  first_name TEXT, last_name TEXT,                     -- C
  preferred_name     TEXT,                             -- H
  pronouns           TEXT,                             -- C+H
  photo_url          TEXT,                             -- C
  -- ── 角色 (C+H) ──
  title              TEXT,                             -- C+H 原始職稱
  title_normalized   TEXT,                             -- S 正規化("VP Engineering")
  role_category      TEXT,                             -- C+H Engineering/Finance/Procurement/…
  department         TEXT,                             -- C+H
  seniority          TEXT,                             -- C+H c_level/vp/director/manager/ic/founder/board
  reports_to_contact_id TEXT,                          -- H/C self-ref FK (組織圖)
  tenure_start_at    INTEGER,                          -- C 加入現公司
  -- ── 觸達 (C 猜 → H 驗) ──
  email              TEXT,                             -- C(猜)+H
  email_verified     INTEGER DEFAULT 0,                -- H  0/1
  phone              TEXT,                             -- C/H
  location_country TEXT, location_city TEXT, timezone TEXT,  -- C
  linkedin_url TEXT, twitter_url TEXT, github_url TEXT, personal_website TEXT, -- C
  -- ── 背景 (C, 公開) ──
  bio                TEXT,                             -- C+H 公開 bio
  background_summary TEXT,                             -- C+H 職涯敘事(匯總)
  previous_companies_json TEXT,                        -- C [{company,title,years}]
  education_json / skills_json / certifications_json TEXT, -- C
  publications_talks_json TEXT,                        -- C 演講/引述/文章 → 揭露優先事項
  interests_json     TEXT,                             -- C+H 個人興趣(社群)
  -- ── PERSONA / 副駕需要的 (多半 H + 會議) ──
  known_priorities_json TEXT,                          -- H (弱 C) 現在在乎什麼
  goals_kpis_json    TEXT,                             -- H 被什麼指標考核
  hot_buttons_json   TEXT,                             -- H 一講就來勁的話題
  pain_points_json   TEXT,                             -- H 他們的痛
  objections_raised_json TEXT,                         -- H [{objection,context,meeting_id,status}] — 多半來自會議
  communication_style TEXT,                            -- H+弱C analytical/driver/amiable/expressive
  comm_style_notes   TEXT,                             -- H "要數據、討厭空話、決斷快"
  decision_style     TEXT,                             -- H risk-averse/consensus/innovator
  preferred_channel  TEXT,                             -- H email/phone/linkedin/in_person
  personality_notes  TEXT,                             -- H 自由文字(DISC/MBTI 猜測 OK)
  -- ── 關係 / 採購角色 (H / S) ──
  is_decision_maker  INTEGER,                          -- H (推測 C) 0/1
  decision_power     TEXT,                             -- H economic_buyer/champion/influencer/gatekeeper/user/blocker/unknown
  influence_level    INTEGER,                          -- H 0-100 內部影響力
  relationship_status TEXT,                            -- H cold/warm/champion/detractor
  relationship_strength INTEGER,                       -- H 0-100
  sentiment          REAL,                             -- S 最近已知(來自會議)
  personal_notes     TEXT,                             -- H 破冰素材(小孩/嗜好/校友)
  next_step          TEXT,                             -- H
  do_not_contact     INTEGER DEFAULT 0,                -- H
  last_interaction_at INTEGER,                         -- S
  owner_user_id      TEXT,                             -- H FK users
  -- ── 爬蟲簿記 + 驗證 ──
  source TEXT, crawl_confidence REAL, last_crawled_at INTEGER,  -- C+H / S
  verified_status TEXT DEFAULT 'none', verified_by TEXT, verified_at INTEGER, -- H
  raw_crawl_json TEXT, custom_fields_json TEXT,        -- S / H
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, -- S
  CHECK (seniority IN ('c_level','vp','director','manager','ic','founder','board') OR seniority IS NULL),
  CHECK (decision_power IN ('economic_buyer','champion','influencer','gatekeeper','user','blocker','unknown') OR decision_power IS NULL),
  CHECK (verified_status IN ('none','partial','verified'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_org         ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org_company ON contacts(org_id, company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org_owner   ON contacts(org_id, owner_user_id);
```

---

## 6. Deals / 商機

### `deals` — H（爬蟲只間接貢獻訊號）
`id/org_id/company_id`, `name`, `stage CHECK('prospect','discovery','demo','proposal','negotiation','closed_won','closed_lost')`, `status CHECK('open','won','lost')`, `amount/currency`, `probability 0-100`, `forecast_category`, `deal_type (new/expansion/renewal)`, `expected_close_at/actual_close_at`, `owner_user_id`, `primary_contact_id/economic_buyer_contact_id/champion_contact_id` (FK contacts), `competitors_json`, `decision_criteria_json` (MEDDIC), `decision_process`, `pain/budget/timeline`, `next_step`, `close_reason`, `health_score` (S/H), `risk_flags_json` (S/H, 由 signals 衍生), `created_at/updated_at`。Index `(org_id, stage)`, `(org_id, owner_user_id)`, `(org_id, company_id)`。

### `deal_contacts` — 採購委員會 join（H）
`(deal_id, contact_id)` PK, `org_id`, `role`(同 decision_power enum), `stance CHECK('supporter','neutral','detractor')`, `influence INTEGER`, `notes`。

### `deal_products` — H
`(deal_id, product_id)` PK, `org_id`, `quantity`, `unit_price`, `notes`。

---

## 7. Meetings / 逐字稿 / 訊號（餵會中副駕 ＋ 回寫）

### `meetings` — S/H
`id/org_id/company_id`, `deal_id`(nullable), `copilot_session_id`(FK 即時 session 表), `title`, `meeting_type CHECK('discovery','demo','negotiation','check_in','qbr','other')`, `platform`, `scheduled_at/started_at/ended_at`, `duration_sec`, `status CHECK('scheduled','completed','canceled','no_show')`, `presenter_user_id`, `agenda`, `summary`(embedded for RAG), `outcome`, `sentiment`, `next_steps_json/action_items_json`, `recording_url`, `created_at/updated_at`。

### `meeting_attendees` — S/H
`id, org_id, meeting_id`, `contact_id`(nullable 外部), `user_id`(nullable 內部), `name`, `is_internal`, `role_in_meeting`, `talk_time_sec`(S), `sentiment`(S)。

### `meeting_transcript_segments` — S
`id, org_id, meeting_id, t INTEGER (ms offset), speaker, speaker_contact_id (nullable FK), is_final INTEGER, text, confidence REAL, lang, created_at`。**Chunk + embed** for RAG。Index `(org_id, meeting_id)`, `(org_id, created_at)`。
> **注意**：`speaker` 的判定在 v2 雙帳號混音模型下是「轉逐字後 LLM 依內容/語氣推斷」（見 DECISIONS 會議模型），不是乾淨分軌。

### `meeting_signals` — S
`id, org_id, meeting_id, segment_id (nullable)`, `type CHECK('interest','objection','pain','competitor_mention','buying_signal','risk','pricing','next_step','landmine')`, `label`, `payload_json`, `entity_ref_json`(關於哪個 contact/deal/product), `confidence REAL`, `created_at`。**這是回寫來源**：一個確認的 `objection` 訊號經**人批准的 enrichment 步驟**（保持 I2 式批准紀律）寫進某 contact 的 `objections_raised_json` / deal 的 `risk_flag`。

---

## 8. 橫切：notes / activities / provenance / crawl jobs

### `notes` — 多型自由筆記（H）
`id, org_id`, `entity_type CHECK('company','contact','deal','meeting')`, `entity_id`, `author_user_id`, `body`(markdown), `note_type CHECK('general','call','email','research')`, `pinned`, `created_at/updated_at`。Embedded for RAG。Index `(org_id, entity_type, entity_id)`。

### `activities` — 時間軸/觸點（S/H）— 撐 `last_interaction_at`
`id, org_id`, `entity_type`, `entity_id`, `deal_id`, `contact_id`, `type CHECK('email','call','meeting','linkedin','task','note','crawl')`, `direction CHECK('inbound','outbound','internal')`, `subject`, `body_summary`, `occurred_at`, `user_id`, `outcome`, `created_at`。Index `(org_id, entity_type, entity_id, occurred_at DESC)`。

### `field_provenance` — **信任層**（S）— 每個爬蟲填的欄位的來源＋信心＋驗證
一筆 `(entity, field)` 值寫入一列。這撐起 UI 的**「確認 / 細填」** 與副駕的「人驗證過的欄位更可信」。

```sql
CREATE TABLE IF NOT EXISTS field_provenance (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,                          -- S
  entity_type  TEXT NOT NULL,                          -- S company/contact/deal/company_news/…
  entity_id    TEXT NOT NULL,                          -- S
  field_name   TEXT NOT NULL,                          -- S e.g. 'industry','email','decision_power'
  value_snapshot TEXT,                                 -- S 寫入的值(scalar 或 JSON)
  filled_by    TEXT NOT NULL,                          -- S crawler/human/llm/import
  source_type  TEXT,                                   -- S company_website/linkedin/crunchbase/news/search/inference/manual
  source_url   TEXT,                                   -- S 出處
  source_detail TEXT,                                  -- S 頁面路徑 / 搜尋 query
  confidence   REAL,                                   -- S 0-1 (human 填則 null = 隱含權威)
  model        TEXT,                                   -- S crawler/model + 版本
  verified     INTEGER NOT NULL DEFAULT 0,             -- S/H 人確認後設 1
  verified_by  TEXT, verified_at INTEGER,              -- H
  superseded_by TEXT,                                  -- S FK self (值被覆寫)
  created_at   INTEGER NOT NULL,                       -- S
  CHECK (filled_by IN ('crawler','human','llm','import'))
);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON field_provenance(org_id, entity_type, entity_id, field_name);
```

**UI 動作對映到寫入：**
- **確認**：把當前 provenance row 設 `verified=1, verified_by, verified_at`（值不變）。
- **細填/覆寫**：把新值寫到實體欄位**且**插入新 provenance row `filled_by='human'`，舊 row 標 `superseded_by`。實體 `verified_status` 升到 `partial`/`verified`。
- 實體粗略 `crawl_confidence` ＝ 其未被 supersede 的 provenance rows 聚合；`verified_status` 反映多少高價值欄位已人驗。

**副駕信任規則（deterministic，所以誠實）**：任一欄位優先取 provenance 為 `filled_by='human'` 或 `verified=1` 的值；否則用爬蟲值但在浮出的卡上標信心徽章，且 `confidence < 0.6` 時措辭改成「據公開資訊/reportedly」。模擬訓練只扮演**人驗證過或會議衍生**的 persona 欄位（絕不拿爬蟲猜測幻想）。

### `crawl_jobs` — enrichment 執行追蹤（S）
`id, org_id`, `target_type CHECK('company','contact')`, `target_id`, `target_domain`, `status CHECK('queued','running','done','failed')`, `requested_by`, `started_at`, `finished_at`, `sources_json`(打過的 URLs), `fields_filled INTEGER`, `error`, `raw_result_ref`, `created_at`。讓 UI 顯示「上次 enrich / 重新 enrich」。

---

## 9. Embedding / 檢索層（兩個消費端的 RAG）

### 嵌入什麼
不是原始 row，而是每個實體的**衍生「profile card」** ＋ **chunk 過的長文**。Card 只由**已驗證/高信心欄位**組成，所以 RAG 浮出的都可信。

| Card / chunk | 由什麼組成 | 何時重生 |
|---|---|---|
| **company_card** | companies 核心 + 匯總 news/tech/funding | company 或其子表變動 |
| **contact_card** | contacts 身分 + persona（已驗欄位加權） | contact 變動 |
| **deal_card** | deal + committee + criteria | deal 變動 |
| **product_card** | products（自家） | product 變動 |
| **company_news** | 每則新聞 summary | insert 時 |
| **meeting_summary** | meeting.summary | summary 寫入時 |
| **transcript_chunk** | 逐字窗（~500 token） | final segment 時 |
| **note** | notes.body | 寫入時 |

### `profile_cards` — 副駕與 UI **共用**的卡片文字（S, 衍生）
`id, org_id, entity_type, entity_id, card_markdown, built_from_hash, model_version, updated_at`。把「rep 看的人類可讀卡」與「embedding」解耦。用 `built_from_hash` 守住重生。

### `embeddings` — 向量索引（S）（v1 pattern：TEXT JSON + JS cosine）
```sql
CREATE TABLE IF NOT EXISTS embeddings (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,                          -- S (scope filter 強制)
  entity_type  TEXT NOT NULL,                          -- S company_card/contact_card/deal_card/product_card/company_news/meeting_summary/transcript_chunk/note
  entity_id    TEXT NOT NULL,                          -- S 來源 row id
  chunk_index  INTEGER NOT NULL DEFAULT 0,             -- S
  content      TEXT NOT NULL,                          -- S 嵌入的確切文字
  content_hash TEXT NOT NULL,                          -- S 未變內容跳過重嵌
  embedding    TEXT NOT NULL,                          -- S JSON number[] (→ pgvector later)
  dims         INTEGER NOT NULL,                       -- S
  model        TEXT NOT NULL,                          -- S 嵌入模型+版本
  token_count  INTEGER,                                -- S
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (org_id, entity_type, entity_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_scope ON embeddings(org_id, entity_type);
```

### **會中副駕**怎麼查
1. 會中上下文 = 本場 `company_id`、其 `contact_ids`(出席者)、`deal_id`，加上滾動 ASR 訊號（興趣話題/異議/對手提及）。
2. 由當前訊號組 query string → `embedText(query)`。
3. JS 暴力 cosine，過濾到 **`org_id` 且白名單**：`entity_id IN (本公司 card + 其 contacts cards + 其 news + 本 deal card) UNION (本 org 所有 product_card + competitor cards)`。租戶＋實體白名單就是讓它「只講對方公司」而非整個 CRM 的關鍵。
4. Top-k chunks → LLM 組出浮到 HUD 的卡（遵守信任規則 + I3：只在 HUD、絕不上被分享畫面）。

### **模擬訓練**怎麼查
載入目標 `contact_card` + persona 欄位（`communication_style`、`personality_notes`、`hot_buttons`、`objections_raised`、`known_priorities`）+ `company_card` + 相關 `deal_card`/過往 `meeting_summary` chunks → 種下扮演 system prompt。只用人驗證/會議衍生的 persona 欄位（信任規則），所以對練對象真實不幻想。

*SQLite 規模註記*：對一個 org 幾千條向量做暴力 cosine 沒問題。不動業務碼的升級：`sqlite-vec` 擴充（SQLite）或 **pgvector**（Postgres），都藏在 `EmbeddingRepository.search()` 後面。

---

## 10. 多租戶 + Repository 層（現在 SQLite、日後 Postgres — 不動業務碼）

### 租戶強制
- 每表 `org_id`。**不存在不收 `orgId` 的 repository 方法**。base repo 對每個讀注入 `WHERE org_id = ?`、對每個寫蓋 `org_id`。只要所有存取走 repo，跨租戶洩漏在結構上不可能。

### 分層
```
service / use-case 層   (業務規則、批准閘、副駕編排)
        │  只依賴 repository *介面* + domain 型別
        ▼
repository 介面         CompanyRepository, ContactRepository, DealRepository,
                        MeetingRepository, ProvenanceRepository, EmbeddingRepository, …
        │
   ┌────┴─────────────────────────┐
   ▼                              ▼
SqliteCompanyRepository      PgCompanyRepository   (未來)
   │ better-sqlite3               │ pg
   ▼                              ▼
        Database *port* (exec / prepare / transaction)
```

**Port 介面**（唯一知道引擎的東西）：
```ts
export interface DbPort {
  get<T>(sql: string, params: unknown[]): T | undefined;
  all<T>(sql: string, params: unknown[]): T[];
  run(sql: string, params: unknown[]): { changes: number };
  tx<T>(fn: () => T): T;            // better-sqlite3: db.transaction; pg: BEGIN/COMMIT
}
```

**Repository 介面（範例）：**
```ts
export interface CompanyRepository {
  create(orgId: string, input: NewCompany): Company;
  findById(orgId: string, id: string): Company | null;
  findByDomain(orgId: string, domain: string): Company | null;      // 爬蟲 dedupe
  list(orgId: string, filter: CompanyFilter, page: Page): Company[];
  update(orgId: string, id: string, patch: Partial<Company>): Company;
  upsertFromCrawl(orgId: string, domain: string, crawled: CrawlPayload): Company; // + provenance rows
}
```
- Repo 擁有 **row↔domain 映射**：`_json` 欄 parse 成 typed 陣列/物件；snake_case ↔ camelCase；epoch-ms ↔ `Date`。Service 從不看到 SQL 或 JSON 字串。
- `upsertFromCrawl` 在同一個 `tx()` 裡寫實體欄位**且**寫 `field_provenance` rows — provenance 永不與值漂移。

### 移植到 Postgres（業務碼不動）
| SQLite（現在） | Postgres（日後） | 被誰藏起來 |
|---|---|---|
| `TEXT` UUID PK | `uuid`（或維持 text） | — |
| `INTEGER` epoch-ms | `bigint`（或 `timestamptz`） | repo 映射 |
| `TEXT` JSON `_json` | `jsonb` | repo 映射 |
| `INTEGER` 0/1 bool | `boolean` | repo 映射 |
| embedding `TEXT` JSON + JS cosine | `vector`(pgvector) + `<=>` | `EmbeddingRepository.search()` |
| `db.transaction(fn)` | `BEGIN/COMMIT` | `DbPort.tx()` |
| `CHECK` enums | `CHECK` / 原生 enum | DDL 相同 |

保持可移植的規則：**業務 SQL 不用 SQLite 專屬函式**（方言怪癖住在 repo impl）、`/migrations/NNN_*.sql` **版本化 migration**＋一個 `schema_migrations` 表的小 runner、**所有向量數學藏在 embedding repo 後面**。換引擎＝寫 `Pg*Repository` + `PgDbPort`；service 層、副駕、trainer 都不動。

---

## 11. 爬蟲實際「能」/「不能」填什麼（要誠實）

**能，從公司網站 + 公開搜尋（LinkedIn/Crunchbase/新聞/徵才板）：**
- *公司*：名稱、法定名、網域、描述、tagline、產業（推斷）、HQ+據點、成立年、logo、社群連結、員工**級距**（僅揭露才有精確值）、產品/服務、官網客戶 logo、認證、獎項、新聞提及+日期、部落格關鍵字、**技術棧**（站台 headers/scripts）、**在徵職缺**（careers → 意向訊號）、募資輪+投資人（公開/新聞）、所有權類型、股票代號。
- *主管*：姓名、現職稱、部門/資歷（由職稱推斷）、LinkedIn URL、公開 bio、前公司、學歷、技能、公開演講/引述/文章、Twitter/GitHub、城市/時區、任期起、**email 格式猜測**（`first.last@domain` — 未驗證）。

**不能可靠（故預設 human / 會議衍生、低或無信心）：**
- **已驗證**的直接 email / 手機（可猜、不可確認 → `email_verified=0`）。
- **decision_power / is_decision_maker / 預算權**——可由職稱弱推斷，真答案來自 discovery 通話。
- **communication_style / personality / hot_buttons / known_priorities / pain_points / objections**——副駕**最高價值**的 persona 欄位。只能由公開寫作弱推斷，壓倒性地**會後人填**或從逐字稿萃取（`meeting_signals` → 批准回寫）。
- 內部事實：現有供應商合約 + **續約日**、真實預算、組織圖內情、私有策略。
- **私有**公司的即時營收（只有估計 + 級距）。

**設計後果（為何整個 schema 長這樣）**：爬蟲**便宜**能填的（firmographics）是**最沒差異化**的情報；真正贏單的欄位（persona、優先事項、異議、決策權）恰恰是爬蟲**不可信**的。這正是為何每個值都帶 `field_provenance`、副駕把 `filled_by='human' | verified=1` 權重壓過爬蟲信心、UI 的全部工作就是靠**確認/細填**把便宜的爬蟲猜測變成已驗真相。

---

## 12. 實作順序（給實作這份的弱模型）

1. Migration runner + `schema_migrations`；§2 租戶 DDL（沿用 v1）→ `companies`、`contacts`（§4–5）→ 其子表。
2. `field_provenance` + `DbPort` + base repository（org-scoping + row/domain 映射 + `tx`）。
3. `CompanyRepository`/`ContactRepository` 含 `upsertFromCrawl`（一個 tx 寫值+provenance）與 `findByDomain` dedupe。
4. Deals/meetings/signals/notes/activities（§6–8）。
5. `profile_cards` builder + `embeddings` repo + JS cosine `search(orgId, queryVec, filter, k)`（移植 v1 `retrieval/index.ts`）。
6. 副駕查詢路徑（§9）+ 模擬訓練 seed builder；把信任規則寫成兩個消費端都呼叫的共用純函式。

**要從 v1 保留的不變量**：每個查詢都 `org_id`-scoped；沒有東西繞過 repo 層直接碰 `db`（這紀律就是讓 Postgres 移植與租戶保證同時成立的原因）。

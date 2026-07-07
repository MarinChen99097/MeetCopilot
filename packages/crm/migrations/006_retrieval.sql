-- 006_retrieval.sql — 信任層 field_provenance ＋ 檢索層 embeddings/profile_cards ＋ crawl_jobs（CRM_SCHEMA §8-9）。
-- §0：無 SQL FOREIGN KEY；enum＝TEXT + CHECK(col IN(...))；org_id 全帶(scope filter 強制)；時間 epoch-ms；JSON 存 TEXT。

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

CREATE TABLE IF NOT EXISTS embeddings (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,                          -- S (scope filter 強制)
  entity_type  TEXT NOT NULL,                          -- S company_card/company_product_card/contact_card/deal_card/product_card/company_news/meeting_summary/transcript_chunk/note
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

CREATE TABLE IF NOT EXISTS profile_cards (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,                         -- S
  entity_type   TEXT NOT NULL,                         -- S company_card/contact_card/company_product_card/deal_card/…
  entity_id     TEXT NOT NULL,                         -- S 來源 row id
  card_markdown TEXT NOT NULL,                         -- S rep 看的人類可讀卡
  built_from_hash TEXT NOT NULL,                       -- S 守住重生(來源未變則跳過)
  model_version TEXT,                                  -- S
  created_at    INTEGER NOT NULL,                      -- S
  updated_at    INTEGER NOT NULL,                      -- S
  UNIQUE (org_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_cards_scope ON profile_cards(org_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,                        -- S  FK orgs
  target_type    TEXT NOT NULL,                        -- S  company/contact
  target_id      TEXT NOT NULL,                        -- S
  target_domain  TEXT,                                 -- S
  mode           TEXT NOT NULL,                        -- S  quick(會中)/detailed(會前)
  status         TEXT NOT NULL DEFAULT 'queued',       -- S
  requested_by   TEXT,                                 -- S  FK users
  started_at     INTEGER,                              -- S
  finished_at    INTEGER,                              -- S
  sources_json   TEXT,                                 -- S  打過的 URLs
  fields_filled  INTEGER,                              -- S
  error          TEXT,                                 -- S
  raw_result_ref TEXT,                                 -- S
  created_at     INTEGER NOT NULL,                     -- S
  CHECK (target_type IN ('company','contact')),
  CHECK (mode IN ('quick','detailed')),
  CHECK (status IN ('queued','running','done','failed'))
);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_org_target ON crawl_jobs(org_id, target_id);

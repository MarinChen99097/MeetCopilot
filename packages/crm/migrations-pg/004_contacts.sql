-- 004_contacts.sql (Postgres) — 對方主管 contacts（CRM_SCHEMA §5）。SQLite migrations/004 的 pg 方言對映。
-- §0/§10：無 SQL FOREIGN KEY；enum＝TEXT + CHECK；org_id 全帶；時間 epoch-ms（bigint）；布林 0/1（bigint）；JSON 存 text。
-- 型別對映：INTEGER → bigint；REAL → double precision；TEXT/_json → text。

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
  tenure_start_at    BIGINT,                           -- C 加入現公司
  -- ── 觸達 (C 猜 → H 驗) ──
  email              TEXT,                             -- C(猜)+H
  email_verified     BIGINT DEFAULT 0,                 -- H  0/1
  phone              TEXT,                             -- C/H
  location_country TEXT, location_city TEXT, timezone TEXT,  -- C
  linkedin_url TEXT, twitter_url TEXT, github_url TEXT, personal_website TEXT, -- C
  -- ── 背景 (C, 公開) ──
  bio                TEXT,                             -- C+H 公開 bio
  background_summary TEXT,                             -- C+H 職涯敘事(匯總)
  previous_companies_json TEXT,                        -- C [{company,title,years}]
  education_json     TEXT,                             -- C
  skills_json        TEXT,                             -- C
  certifications_json TEXT,                            -- C
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
  is_decision_maker  BIGINT,                           -- H (推測 C) 0/1
  decision_power     TEXT,                             -- H economic_buyer/champion/influencer/gatekeeper/user/blocker/unknown
  influence_level    BIGINT,                           -- H 0-100 內部影響力
  relationship_status TEXT,                            -- H cold/warm/champion/detractor
  relationship_strength BIGINT,                        -- H 0-100
  sentiment          DOUBLE PRECISION,                 -- S 最近已知(來自會議)
  personal_notes     TEXT,                             -- H 破冰素材(小孩/嗜好/校友)
  next_step          TEXT,                             -- H
  do_not_contact     BIGINT DEFAULT 0,                 -- H
  last_interaction_at BIGINT,                          -- S
  owner_user_id      TEXT,                             -- H FK users
  -- ── 爬蟲簿記 + 驗證 ──
  source TEXT, crawl_confidence DOUBLE PRECISION, last_crawled_at BIGINT,  -- C+H / S
  verified_status TEXT DEFAULT 'none', verified_by TEXT, verified_at BIGINT, -- H
  raw_crawl_json TEXT, custom_fields_json TEXT,        -- S / H
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, -- S
  CHECK (seniority IN ('c_level','vp','director','manager','ic','founder','board') OR seniority IS NULL),
  CHECK (decision_power IN ('economic_buyer','champion','influencer','gatekeeper','user','blocker','unknown') OR decision_power IS NULL),
  CHECK (verified_status IN ('none','partial','verified'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_org         ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org_company ON contacts(org_id, company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org_owner   ON contacts(org_id, owner_user_id);

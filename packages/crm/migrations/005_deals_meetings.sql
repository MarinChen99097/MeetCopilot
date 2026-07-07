-- 005_deals_meetings.sql — 商機、會議、逐字稿、訊號、筆記、活動（CRM_SCHEMA §6-8）。
-- §0：無 SQL FOREIGN KEY；enum＝TEXT + CHECK(col IN(...))；org_id 全帶；時間 epoch-ms；布林 0/1；JSON 存 TEXT。

-- ── §6 商機 ──

CREATE TABLE IF NOT EXISTS deals (
  id                        TEXT PRIMARY KEY,
  org_id                    TEXT NOT NULL,            -- S  FK orgs
  company_id                TEXT NOT NULL,            -- H  FK companies
  name                      TEXT NOT NULL,            -- H
  stage                     TEXT NOT NULL DEFAULT 'prospect', -- H
  status                    TEXT NOT NULL DEFAULT 'open',     -- H
  amount                    REAL,                     -- H
  currency                  TEXT,                     -- H
  probability               INTEGER,                  -- H  0-100
  forecast_category         TEXT,                     -- H
  deal_type                 TEXT,                     -- H  new/expansion/renewal
  expected_close_at         INTEGER,                  -- H
  actual_close_at           INTEGER,                  -- H
  owner_user_id             TEXT,                     -- H  FK users
  primary_contact_id        TEXT,                     -- H  FK contacts
  economic_buyer_contact_id TEXT,                     -- H  FK contacts
  champion_contact_id       TEXT,                     -- H  FK contacts
  competitors_json          TEXT,                     -- H
  decision_criteria_json    TEXT,                     -- H  MEDDIC
  decision_process          TEXT,                     -- H
  pain                      TEXT,                     -- H
  budget                    TEXT,                     -- H
  timeline                  TEXT,                     -- H
  next_step                 TEXT,                     -- H
  close_reason              TEXT,                     -- H
  health_score              INTEGER,                  -- S/H
  risk_flags_json           TEXT,                     -- S/H  由 signals 衍生
  created_at                INTEGER NOT NULL,         -- S
  updated_at                INTEGER NOT NULL,         -- S
  CHECK (stage IN ('prospect','discovery','demo','proposal','negotiation','closed_won','closed_lost')),
  CHECK (status IN ('open','won','lost')),
  CHECK (deal_type IN ('new','expansion','renewal') OR deal_type IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_deals_org_stage   ON deals(org_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_org_owner   ON deals(org_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_org_company ON deals(org_id, company_id);

CREATE TABLE IF NOT EXISTS deal_contacts (
  deal_id    TEXT NOT NULL,                           -- FK deals
  contact_id TEXT NOT NULL,                           -- FK contacts
  org_id     TEXT NOT NULL,                           -- S  FK orgs
  role       TEXT,                                    -- H  同 decision_power enum
  stance     TEXT,                                    -- H  supporter/neutral/detractor
  influence  INTEGER,                                 -- H
  notes      TEXT,                                    -- H
  PRIMARY KEY (deal_id, contact_id),
  CHECK (role IN ('economic_buyer','champion','influencer','gatekeeper','user','blocker','unknown') OR role IS NULL),
  CHECK (stance IN ('supporter','neutral','detractor') OR stance IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_deal_contacts_org_deal ON deal_contacts(org_id, deal_id);

CREATE TABLE IF NOT EXISTS deal_products (
  deal_id    TEXT NOT NULL,                           -- FK deals
  product_id TEXT NOT NULL,                           -- FK products (賣方自家；002)
  org_id     TEXT NOT NULL,                           -- S  FK orgs
  quantity   INTEGER,                                 -- H
  unit_price REAL,                                    -- H
  notes      TEXT,                                    -- H
  PRIMARY KEY (deal_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_products_org_deal ON deal_products(org_id, deal_id);

-- ── §7 會議 / 逐字稿 / 訊號 ──

CREATE TABLE IF NOT EXISTS meetings (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,                   -- S  FK orgs
  company_id         TEXT NOT NULL,                   -- S/H FK companies
  deal_id            TEXT,                            -- S/H FK deals (nullable)
  copilot_session_id TEXT,                            -- 跨模組參照(M3 realtime session)；nullable、無 FK
  title              TEXT,                            -- S/H
  meeting_type       TEXT,                            -- H
  platform           TEXT,                            -- S/H
  scheduled_at       INTEGER,                         -- S/H
  started_at         INTEGER,                         -- S
  ended_at           INTEGER,                         -- S
  duration_sec       INTEGER,                         -- S
  status             TEXT,                            -- S
  presenter_user_id  TEXT,                            -- S/H FK users
  agenda             TEXT,                            -- H
  summary            TEXT,                            -- S  embedded for RAG
  outcome            TEXT,                            -- S/H
  sentiment          REAL,                            -- S
  next_steps_json    TEXT,                            -- S
  action_items_json  TEXT,                            -- S
  recording_url      TEXT,                            -- S
  created_at         INTEGER NOT NULL,                -- S
  updated_at         INTEGER NOT NULL,                -- S
  CHECK (meeting_type IN ('discovery','demo','negotiation','check_in','qbr','other') OR meeting_type IS NULL),
  CHECK (status IN ('scheduled','completed','canceled','no_show') OR status IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_meetings_org_company ON meetings(org_id, company_id);

CREATE TABLE IF NOT EXISTS meeting_attendees (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,                       -- S  FK orgs
  meeting_id     TEXT NOT NULL,                       -- S  FK meetings
  contact_id     TEXT,                                -- S/H FK contacts (nullable 外部)
  user_id        TEXT,                                -- S/H FK users (nullable 內部)
  name           TEXT,                                -- S/H
  is_internal    INTEGER,                             -- S/H 0/1
  role_in_meeting TEXT,                               -- S/H
  talk_time_sec  INTEGER,                             -- S
  sentiment      REAL,                                -- S
  created_at     INTEGER NOT NULL                     -- S
);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_org_meeting ON meeting_attendees(org_id, meeting_id);

CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,                   -- S  FK orgs
  meeting_id         TEXT NOT NULL,                   -- S  FK meetings
  t                  INTEGER,                         -- S  ms offset
  speaker            TEXT,                            -- S  (LLM 依內容/語氣推斷)
  speaker_contact_id TEXT,                            -- S  FK contacts (nullable)
  is_final           INTEGER,                         -- S  0/1
  text               TEXT,                            -- S
  confidence         REAL,                            -- S
  lang               TEXT,                            -- S
  created_at         INTEGER NOT NULL                 -- S
);
CREATE INDEX IF NOT EXISTS idx_transcript_org_meeting ON meeting_transcript_segments(org_id, meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcript_org_created ON meeting_transcript_segments(org_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_signals (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,                      -- S  FK orgs
  meeting_id      TEXT NOT NULL,                      -- S  FK meetings
  segment_id      TEXT,                               -- S  FK segments (nullable)
  type            TEXT NOT NULL,                      -- S  見 CHECK
  label           TEXT,                               -- S
  payload_json    TEXT,                               -- S
  entity_ref_json TEXT,                               -- S  關於哪個 contact/deal/product
  confidence      REAL,                               -- S
  created_at      INTEGER NOT NULL,                   -- S
  CHECK (type IN ('interest','objection','pain','competitor_mention','buying_signal','risk','pricing','next_step','landmine'))
);
CREATE INDEX IF NOT EXISTS idx_meeting_signals_org_meeting ON meeting_signals(org_id, meeting_id);

-- ── §8 橫切：notes / activities ──

CREATE TABLE IF NOT EXISTS notes (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,                       -- S  FK orgs
  entity_type    TEXT NOT NULL,                       -- H  company/contact/deal/meeting
  entity_id      TEXT NOT NULL,                       -- H
  author_user_id TEXT,                                -- H  FK users
  body           TEXT NOT NULL,                       -- H  markdown；embedded for RAG
  note_type      TEXT DEFAULT 'general',              -- H
  pinned         INTEGER DEFAULT 0,                   -- H  0/1
  created_at     INTEGER NOT NULL,                    -- S
  updated_at     INTEGER NOT NULL,                    -- S
  CHECK (entity_type IN ('company','contact','deal','meeting')),
  CHECK (note_type IN ('general','call','email','research'))
);
CREATE INDEX IF NOT EXISTS idx_notes_org_entity ON notes(org_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS activities (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,                         -- S  FK orgs
  entity_type  TEXT NOT NULL,                         -- S/H
  entity_id    TEXT NOT NULL,                         -- S/H
  deal_id      TEXT,                                  -- S/H FK deals
  contact_id   TEXT,                                  -- S/H FK contacts
  type         TEXT NOT NULL,                         -- S/H 見 CHECK
  direction    TEXT,                                  -- S/H inbound/outbound/internal
  subject      TEXT,                                  -- S/H
  body_summary TEXT,                                  -- S/H
  occurred_at  INTEGER,                               -- S/H
  user_id      TEXT,                                  -- S/H FK users
  outcome      TEXT,                                  -- S/H
  created_at   INTEGER NOT NULL,                      -- S
  CHECK (type IN ('email','call','meeting','linkedin','task','note','crawl')),
  CHECK (direction IN ('inbound','outbound','internal') OR direction IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_activities_org_entity ON activities(org_id, entity_type, entity_id, occurred_at DESC);

# CRM × DynamicSlide × 模擬訓練 升級計畫（2026-07-23 起，多階段）

> 使用者 2026-07-23 連續三則訊息提出的一整套升級需求，收斂於此，避免跨 session/context 遺失。
> 執行紀律：每階段先凍契約→派工→fresh-context 驗證→（使用者核准）部署→再進下一階段。決策記 ROM、程式改動記 CHANGE_TRACKER。

## 需求全集（原話對照）

- **[R1] AI 補充頁品質**（2026-07-23 訊息 2）：補充頁「跟 CRM 內容沒有直接相關、也沒有寫好給講者的稿，講者不知道該講什麼」；「排版過度單一沒美感，3 個欄位不該 2 上 1 左下、至少三角形，且每頁都長一樣」。
- **[R2] CRM 可編輯校正**（訊息 1）：CRM 有錯誤敘述但無管道更正；要能**直接編輯**，且修正後的資料要成為**後續爬取的正確背景**（在正確背景下抓更多）。
- **[R3] 政府資料爬取**（訊息 1）：CRM 資料太少；公司常與政府合作（標案/採購），要爬政府相關管道。
- **[R4] 模擬訓練可用性**（訊息 3）：
  - (a) 要能**手動新增單一主管**＋他的事情（現在無法，導致無對象可訓練）。
  - (b) CRM 要有**像筆記欄的自由填寫區塊**，讓使用者直接填內容 → **AI 依內容歸位**到結構化欄位 → 也可**依筆記內容做額外研究/調查**。
  - (c) 「已驗證」改成**手動點**（按鈕），不要用欄位內容自動判定（否則很難測試）。
- **[R5] 合成/設計式訓練對象**（2026-07-23 訊息 5）：模擬面談對象**不必是真人**；可**設計對象的人格特質**，再**搭配對方公司的 CRM 內容 ＋ 銷售目的 ＋ 面談目的**組成對練情境。

## 階段規劃

### Phase A — CRM 人工掌控（含測試解鎖，優先）
對應 R2 + R4。先做「解鎖測試」的小改，再做編輯與筆記歸位。
- A1. **手動「已驗證/解鎖對練」開關**（R4c）：persona/contact 加一個手動 verified 切換，取代/覆蓋自動判定的訓練閘 → 立即解鎖模擬訓練測試。
- A2. **手動新增單一主管/聯絡人**＋其欄位（R4a）：create-contact UI＋端點（若無則補）。
- A3. **敘述型/陣列欄位可編輯**（R2）：前端為 company/persona/product 的 description、pain_points、hot_buttons… 補 textarea/chip 編輯器，接既有 `PATCH`＋`applyHumanUpdate`（後端已支援任意欄、寫 human/verified=1）。
- A4. **自由筆記 → AI 歸位 ＋ 延伸研究**（R4b）：一個筆記/自由填寫入口；送出後 AI 把內容歸位到結構化欄位（company/persona），並可依內容觸發研究 job。
- A5. **人工值不被重爬覆寫 ＋ 餵回爬取背景**（R2）：products/子表 upsert 補 `trustedFieldsOf` 檢查；爬取前把已確認的 CRM 權威值注入研究 prompt 當背景。
- A6. **合成/設計式訓練對象**（R5）：模擬訓練 startSession 支援「非真人」對象——可設計人格特質（自由描述→AI 歸位成 persona 欄，或直接填），並在 `buildPersonaPrompt` 融入「對方公司 CRM 內容＋銷售目的＋面談目的」三項情境參數（新增 train session 設定欄位；不必綁真 contact，可用暫時/合成 persona）。與 A1（手動解鎖）、A2（新增主管）、A4（筆記→歸位）協同。
- 既有現況（前次調查）：後端 `PATCH`→`applyHumanUpdate` 已支援任意欄；company/contact 重爬有 `trustedFieldsOf` 防覆寫；provenance 逐欄（`field_provenance`）。缺口＝前端編輯器、products 子表防覆寫、爬取背景注入、create-contact UI、手動 verified、筆記歸位。

### Phase B — AI 補充頁升級（契約已凍結，見下）
對應 R1。CRM 取材＋講者口白（HUD 專用、守 I3）＋版型多樣與美化（3 項三角形、每頁換版型）。

### Phase C — 政府資料爬取
對應 R3。GCIS 公司登記 API（官方免費 JSON、無驗證碼→統編/資本額/董監事）＋決標/標案得標紀錄（走 g0v JSON 或 data.gov.tw 開放資料，避官網驗證碼與法遵風險）。需 migration：companies 加 `tax_id`（統編，政府 API 的 match key）＋新子表 `company_gov_contracts{tender_no, project_name, agency, amount, award_date, source_url}`。經 `safeFetcher`（SSRF-safe），落 CRM＋provenance，不動 I1/I2/I3。

## Phase B 凍結契約（實作只照此，不再改）

- **shared** `packages/shared/src/protocol.ts`：`Suggestion` 加選填 `speakerNotes?: string`（講者口白，HUD 專用，**絕不進 SlideSpec/deck**，守 I3）。`ServerMessage.suggestion` 不動（已引用 Suggestion）。
- **生成** `generateSupplementSlide`（`slide-gen.ts`）：input 加 `crmContext?`（CRM 取材）、`avoidLayout?`（排除上一張版型）；回傳改 `{ slide: SlideSpec; speakerNotes?: string } | null`。新增 `SUPPLEMENT_SLIDE_SCHEMA`＝SLIDE_SCHEMA **移除 notes**＋**加 speakerNotes**（口白不落 slide.notes）。
- **orchestrator**：`suggestSlideCb`/`onSuggestSlide` 尾端加選填 `speakerNotes?`；`maybeSuggestSlide` 組 `crmContext`（直接讀本場 company＋其 contacts 的既有非空值＝§9 白名單實體，org-scoped，不套 verified-only）、傳 `avoidLayout`（新 `lastSuggestLayout` Map，記 `template/主導block`）、成功後 set；`disposeSession` 清 Map。
- **patch-service** `suggest(...)` ＋凍結接縫 `copilot.ts:55` 同步加選填 `speakerNotes?`；append 的是 `suggestion.slide`（結構上不含口白）。
- **hub**：`onSuggestSlide` 佈線多帶 notes。
- **web**：`SuggestionQueue.tsx` 顯示 `speakerNotes`（口白區塊，HUD only）；`SlideRenderer.tsx` features case 加 `feat-count-N` class；`studio-present.css` 對 `.feat-count-3` 給置中 flex-wrap（2/4 項不動）。
- **I3 驗證點**：口白只在 Suggestion；ACCEPT append 的 slide 與 `deck_update`/present 不含口白；present 渲染只讀 eyebrow+blocks+logo。
- **要更新/新增測試**：supplement-slide.test（+speakerNotes 斷言、+avoidLayout 斷言）；新 I3 測試（口白不入 deck_update、只在 suggestion/hud）；mid-meeting-crm.test（+crmContext 含本場欄位值、不含他 org）。

## 執行順序（現行）

1. **Phase A**（解鎖測試優先：A1 手動 verified → A2 新增主管 → A3 編輯 → A4 筆記歸位 → A5 防覆寫/背景注入）
2. **Phase B**（補充頁升級，契約已凍）
3. **Phase C**（政府爬取，含 migration）

（順序可由使用者調整。B 的契約已凍可隨時實作；A 的 A1/A2 為最小測試解鎖、價值即時。）

## 狀態

- 2026-07-23：計畫建立；Phase A、B 藍圖皆凍結（agent 藍圖）。
- 2026-07-23：**Phase A Cycle 1 實作完成**（A1 手動解鎖 training_unlocked＋migration 020／A2 新增主管補欄／A5a 產品·contact 子表 trustedFieldsOf 防覆寫），多視角對抗式驗證進行中；未 commit。R5（合成訓練對象）納入計畫 A6，待後續 cycle。

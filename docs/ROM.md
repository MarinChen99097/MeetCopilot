# ROM — 決策總帳（強制）

> 使用者 2026-07-07 指示建立（決策 19）：記錄「**使用者或 Claude 下的所有決策**」。
> 這**不是** memory 那種要精簡的東西——是**更大、更雜**的決策帳本：可以長、可以囉嗦、要帶完整脈絡，寧多勿漏。
> 與 `00-DECISIONS.md` 的分工：00-DECISIONS 是**蒸餾後的產品既定前提**（少而精，衝突時以它為準）；
> ROM 是**未蒸餾的全量帳**（誰決定、何時、為什麼、考慮過什麼替代、連被否決的都記）。

## 規則

1. **任何決策當下就記**：使用者的指示/拍板、指揮官（Fable）的設計取捨、預設值選擇、範圍裁決、
   「決定**不**做某事」、agent 建議被採納或否決——全部都算。不可延後補寫。
2. 每筆格式（**可以長**，照抄模板）：
   ```
   ### YYYY-MM-DD HH:MM | 決策標題
   - **誰決定**: 使用者｜Fable｜使用者採納 agent 建議｜…
   - **決策**: 決定了什麼（完整寫，不用省字）
   - **脈絡與理由**: 為什麼、當時的情況
   - **考慮過的替代**: 有哪些選項、為何不選（沒有就寫「無」）
   - **影響**: 影響哪些檔案/里程碑/後續（有就寫）
   ```
3. **寫入方法同 CHANGE_TRACKER**：嚴禁 Write 覆寫本檔；先 `Read(offset=1, limit=10)` 確認錨點在，
   再用 Edit 以 `---`＋空行＋`<!-- ROM_BELOW -->` 為 old_string 前綴，把新紀錄插在錨點正下方（新上舊下）。
4. **每滿 500 行歸檔**：
   1. 把 `<!-- ROM_BELOW -->` 以下**全部**搬到 `docs/rom_archives/ROM_NNN.md`（NNN 自 `001` 起**依序遞增**，不用日期當檔名）；
   2. 為該歸檔寫一則**簡介**登錄到下方「歸檔目錄」：涵蓋期間＋本批主要決策主題 3–6 條（讓之後不開檔就能判斷要不要點進去）；
   3. 清空本檔（保留標頭＋規則＋歸檔目錄＋錨點），再插入新紀錄。
5. **查決策的順序**：`00-DECISIONS.md`（現行前提）→ 本檔錨點下方（近期）→「歸檔目錄」簡介定位到 `ROM_NNN.md`（歷史）。

## 歸檔目錄（每個歸檔一則簡介，供快速查詢）

| 檔案 | 涵蓋期間 | 簡介 |
|---|---|---|
| （尚無歸檔） | | |

---

<!-- ROM_BELOW -->

### 2026-07-18 | 研究引擎擴編的修法拍板（兩路調查回報後 Fable 凍結契約）
- **誰決定**: Fable（依兩路 Opus 調查證據）
- **決策**（廣度包 S1＋產品包 S2＋web 包，S1→S2 依序、web 平行——S1/S2 共用 orchestrator/deep-extractor 檔案故不平行）：
  1. **P0 語言判定治本**：基礎查詢**一律雙語**（zh+en 全角度都出），isBilingual 廢除排除語意只留排序用——Connact AI（英文名＋.ai 域）被誤判非華語、round 1 全英文是「外部只剩 1 筆 bnext」的第一因。gap 加深查詢同步雙語化。
  2. **P0 grounding 升模**：generateGrounded 帶 extractModel（gemini-3.5-flash）取代 textModel（flash-lite，config 自註對抽取 UNRELIABLE）。
  3. **P1 深讀擴編**：DEEP_RESEARCH_MAX_SOURCES 預設 6→12、clamp 上限 10→20；SafeFetcher 失敗/<200 字時 **fallback 到 Playwright 渲染抓取**（SSRF 防護沿用 crawler 機制、上限 8 個/每個 20s）——救回 104/cakeresume/中文 SPA 新聞站。
  4. **P1 查詢角度擴編**：ANGLES 加 徵才(104/cakeresume)/客戶案例/評測/政府商工登記/獲獎 五角度（雙語）。
  5. **P2 per-contact 補查**：對 deep 找到的主管（≤5 人）逐人一條 grounding 補職稱/學經歷/linkedin，僅填空欄。
  6. **P2 商機路徑開通**：deep-extractor 加 opportunities[]（採購訊號/擴編/新專案/合作），落**筆記（observations）**帶 provenance——**不自動建 deals**（deals 語意=我方銷售管線，研究訊號≠成交案；自動建會污染 pipeline，留給使用者判斷後手動建）。
  7. **產品治本＝per-product 二段式**：第一段列清單後，對每個有專頁的產品（≤10）單獨跑聚焦抽取（該頁全文 12K 不砍半＋單品 rich schema 含 techStack/competitors），fill-empty merge；prompt 加硬性最低具體度（≥3 keyFeatures 含 detail、目標客群、有規格表必填 specs）。
  8. **每頁截斷動態化**：頁數少時每頁給足 12K（總量逼近 180K 才降回 6K）——修「小站被大站防呆誤傷」。
  9. **deep 產品外部回填**：deep-extractor 加 products[]（differentiators/competitors/notableCustomers），僅以名稱對齊**回填官網既有產品**（配不到的進 uncategorized，不建新品防重複）。
  10. **來源展示補真**：job.sources 納入已引用未深讀的 citation（resolve 後，總量 cap 60）；官網 case-study 連結權重 2→4。
  11. **UI 補顯示既有資料**：ProductsTab 補 render specs 表格、keyFeatures 的 detail/benefit、targetPersonas/competitors/pricingNotes/productUrl/docsUrl。
- **考慮過的替代**: isBilingual 加更多啟發式訊號（否——多語查詢成本極低，直接全雙語最穩）；商機自動建 deals（否——語意錯置＋污染管線）；deep 外部產品建新列（否——重複風險）；S1/S2 平行＋worktree（否——同檔合併成本高於序跑）。
- **影響**: apps/server/src/research/*（deep-research/deep-rounds/deep-extractor/extractor/crawler/orchestrator/grounding）＋gemini.ts＋config/.env.example＋apps/web ProductsTab/messages。預估單次 deep 耗時 118s→250-350s、token 成本↑（grounding 升模＋查詢×2＋深讀×2＋二段式），均在 20 分軟預算/60 分 job 上限內；admin 用量報表可觀察。驗證含 Connact AI 本地重跑**前後對照**。

### 2026-07-18 | 研究引擎廣度/深度不足＋產品不夠具體（使用者看 ConnactAI 重研究結果後下令）
- **誰決定**: 使用者（部署 00012-drd/00010-lmf 後對 ConnactAI 重跑深度研究，看結果截圖）
- **決策**: 兩項不滿意，立案改善：
  1. **找的範圍不夠多也不夠深**：來源 12 筆中 11 筆是 connact.ai 自家頁面、外部僅 1 筆 bnext——「全網深度研究」實質上還是官網爬蟲＋一點點外部；主管 1/新聞 2/商機 0，資料量太少。
  2. **產品/服務不夠具體**：4 個產品仍是泛描述，看不出對方實際賣什麼、怎麼賣。
- **脈絡與理由**: 品質四修（migration 015 輪）解決了「欄位裝不下＋UI 不顯示」，但引擎本身的搜索廣度（query 角度數、外部深讀數、輪數）與產品頁挖掘深度是另一層瓶頸，這輪處理引擎。
- **考慮過的替代**: 無（使用者直接指示）。
- **影響**: 待兩路 Opus 調查（引擎預算/來源管線、產品具體度路徑）回報後定契約；預計動 apps/server/src/research/ 的 deep-research/deep-rounds/deep-extractor/crawler/extractor。

### 2026-07-18 | CRM 品質四項的修法拍板（兩路 Opus 調查回報後 Fable 凍結契約）
- **誰決定**: Fable（依兩路調查證據）
- **決策**:
  1. **研究卡死＝A+C 組合**：(A) 啟動 reaper——server boot 在 migrate 後把 crawl_jobs 殘留 queued/running 一律標 failed（max-instances=1 故安全；同時修掉 prod 現存的 CyberPower 卡死列，部署即自癒）；(C) 前端逃生口——EnrichPanel 對 running 且年齡 >65 分（startedAt??createdAt）顯示「已中斷，可重新發起」＋解鎖按鈕＋可關閉/重試。**不做** B 心跳欄（in-process watchdog 已涵蓋大宗，lazy-finalize 在 GET 寫 DB 味道差）與 D 部署層 min-instances≥1（成本高且不治本）。
  2. **schema 加五欄**（SQLite＋PG 各一支新 migration）：companies.industry_zh／tagline_zh／business_model_zh、company_products.model、contacts.full_name_zh。**保留雙語不變量**（主要欄留來源語言、繁中走 *Zh gloss＋UI 優先顯示——不覆寫主要欄，護 provenance）。
  3. **圖片走既有欄免 migration**：crawler 補抓 og:image＋頁內 <img>（絕對 URL、每頁上限、濾 icon/追蹤像素）→ 抽取器把產品圖填 mediaUrls、人物照填 photoUrl（僅官網來源 best-effort）；**deep 第三方來源的人物照不做**（比對人名成本高、錯配風險大）→ 記債。
  4. **繁中 UI bug 一併修**：titleZh/backgroundSummaryZh 已落庫卻沒 render——PersonaCard/ContactsTab 補顯示；ContactSummary 型別＋清單 SELECT 加 titleZh、fullNameZh。
  5. **人物中文名**：新欄 fullNameZh（不複用 preferredName——語意不同）；prompt 明令僅從來源取得、查不到留空，不得音譯捏造。
  6. **派工結構**：Workflow 兩包平行（server 包＝migration/types/mappers/prompt/爬圖/orchestrator 落庫/reaper；web 包＝五元件＋api.ts＋i18n messages），契約（欄名/API 形狀）由 Fable 先凍結，兩包互不碰對方檔案（硬規則 6）；驗證＝build+vitest＋雙對抗審查＋本地對 Connact AI 重跑 deep E2E（驗 responseSchema 改動不炸真實 Gemini 呼叫）。
- **考慮過的替代**: 只修 UI 顯示 *Zh 不加欄（否——使用者點名要型號＋中文名，缺欄裝不下）；產品型號塞 specs 不加欄（否——一級欄乾淨、UI 好 render）；改抽取器直接輸出全繁中覆寫主要欄（否——破壞來源語言可回溯）。
- **影響**: apps/server/src/research/*、apps/server/src/index.ts、packages/crm（migrations×2＋mappers＋清單 repo）、packages/shared/crm-types.ts、apps/web CRM 五元件＋messages。既有 CyberPower 英文資料屬舊管線產物——部署後按鈕解鎖，重按「研究此公司」即以新管線重抽。

### 2026-07-18 | CRM 資料品質整理四項要求（使用者看 CyberPower 詳頁截圖後下令）
- **誰決定**: 使用者（線上 CRM 公司詳頁 CyberPower 截圖三張）
- **決策**:
  1. **產品深檔要能看懂對方公司的服務**：只寫「USB 充電器」太模糊——應呈現**型號＋圖片＋簡單功能簡介**。
  2. **人物要中文名＋照片**：CyberPower 主管全是台灣人，目前只有英文拼音名（Ho, Lien-Hsun / President）——應有中文名字＋圖片。
  3. **顯示內容以 i18n 為主**：除專有名詞外一律繁體中文（目前人物職稱、產業別 "Electrical Components & Equipment"、總覽 overview 都是英文）。
  4. **「研究此公司」卡死要修**：研究早已停止，UI 仍顯示「研究中」＋按鈕鎖死——查根因並修。
- **脈絡與理由**: 使用者實際用線上版對 CyberPower 跑全網深度研究後檢視成果，發現資料「過於混亂與不清楚」——CRM 是三產品的核心地基，資料品質直接決定 DynamicSlide／副駕／模擬訓練的輸出品質。
- **考慮過的替代**: 無（使用者直接指示）。
- **影響**: 待兩路 Opus 調查（抽取管線＋schema、研究 job 狀態生命週期）回報後定修法契約；預計動 apps/server/src/research/ 抽取 prompt、packages/shared crm-types、apps/web CRM 元件；修完照硬規則 10 問 commit＋部署。

### 2026-07-17 | 對比徹查結果採信＋修法拍板（button color:inherit＋color-scheme:dark）
- **誰決定**: Fable（依 4 鏡頭對抗式徹查 workflow 證據；40 agents，raw 18→dedup 11→confirmed 6／killed 5）
- **決策**:
  1. **採信單一根因**：全域 `button{font-family:inherit}` 缺 `color:inherit`＋全站無 `color-scheme:dark` → 五種卡片型 `<button>` 標題（companycard/contactrow/productrow/personacard/deckcard）吃 UA ButtonText≈黑，於 --mc-card 對比 1.21:1（4 名反駁者獨立重算一致）。「未驗證」badge 經重算 ~5:1＝刻意弱化非缺陷（killed）；admin 為淺色主題無此缺陷（其 button 同缺 color:inherit 記潛在債不修）。
  2. **修法＝治本三件**：(a) `button{color:inherit}`（一條治六處，含唯讀 studio-present.css 的 deckcard 靠繼承修、不動該檔）；(b) `:root{color-scheme:dark}`（UA 表單控件/下拉/捲軸原生深色，杜絕同族；.mc-google__btn 的 light 保留）；(c) CRM 新增公司三個裸 input 補 .mc-input＋id/name。誤傷掃描 0（淺底按鈕全都明設 color）。
  3. **殘項記債**：ContactsTab 兩個裸 input（吃 color-scheme:dark 後反而變佳，留待日後統一）；admin button color:inherit；token-math 鏡頭 agent 陣亡（StructuredOutput cap），其範圍由另兩鏡頭覆蓋（muted/badge 全對 ≥5:1 實算過）——不重跑。
- **考慮過的替代**: 逐 class 補 color（否——治標，漏網率高）；只加 color-scheme:dark 不加 color:inherit（否——button 的 UA color 是元素級宣告，dark 下 ButtonText 變白仍屬 UA 控制，雙保險才穩）。
- **影響**: apps/web globals.css/CompanyListView；驗證中；本地過目後照硬規則 10 問 commit＋部署。
- **誰決定**: 使用者（部署後看線上 CRM 對方產品深檔截圖）
- **決策**:
  1. **深色模式對比問題徹查**：產品列標題在深底上近黑字（對比過低）；要求「徹查所有的前端是否有類似的問題」——不只修這一處，全前端（web＋admin）掃同類對比缺陷。Fable 初步嫌疑＝`<button>` 型列（mc-productrow/mc-contactrow 等）未宣告 color，吃瀏覽器 UA 近黑預設（body 的 color 不會繼承進 button），待 workflow 查證。
  2. **工作型態入憲**：使用 Fable 時，Fable 一律是計畫者（planner/決策/審查）；Coder 或其他執行工作一律派較低效能 agent（Opus 等）。寫進 CLAUDE.md（參考 ezpage 的 CLAUDE.md 與 skills 的寫法）。MAINTENANCE 規定改硬規則需使用者同意——本次即使用者直接下令，授權成立。
- **考慮過的替代**: 無（使用者直接指示）。
- **影響**: 對比修復批（apps/web globals.css＋可能 admin CSS）；CLAUDE.md 硬規則 1 強化；記憶 dispatch-fable-decides-opus-investigates 同步。修完照慣例本地過目後才 commit/部署。
- **誰決定**: Fable（依 E2E 測試 agent 回報；使用者指示本地測試新爬蟲）
- **決策**:
  1. **E2E 結果採信＝功能端到端可用**：deep 研究 Connact AI（台灣康耐德，引擎正確辨識非同名以色列新創）98 秒 done、50 欄落庫、narrative＋observations 兩單例筆記正確、embeddings 11 列自動建、provenance 指真實第三方（cake.me/findit.org.tw）、無 YOUTUBE_API_KEY 時 YouTube 優雅 skip 且 job 不失敗。
  2. **修缺口 1——社群帳號發現太窄（social_links 落空）**：(a) `collectSocialHrefs` 從只掃首頁擴為掃**所有已爬頁面**；(b) deep 擷取 schema 加選填 `socialLinks`（prompt 明令僅官方帳號、不確定不填）由 grounding 來源回填；合併規則＝官網爬到的優先、擷取器補缺，一律過 `classifySocialUrl` 正規化（機械保險：只收 https＋四平台網域）。
  3. **修缺口 2——uncategorized 來源轉址未還原**：`resolveMerged` 解析集合漏了只出現在 uncategorized 的 sourceUrl → 納入（同 30s 預算 best-effort，解析不到保留原 URL）。
  4. 驗證方式＝修復 agent 對 Connact AI **重跑 deep** 實測（social_links 落庫內容＋observations 來源還原），非只靠單元測試。
  5. 順帶採納測試 agent 環境建議記 backlog：dev server stdout 導固定檔供稽核。
- **脈絡與理由**: 使用者要先本地測試再談 commit/部署；實測即暴露「發現機制窄」與「還原集合漏項」兩個真實品質缺口——正是 2026-07-09 立案「爬蟲效果不佳」要解的那類問題，當下修。
- **考慮過的替代**: social 發現改用無頭瀏覽器等 JS 渲染後再掃（否——已爬頁面掃描＋擷取器回填已覆蓋主要情境，成本低得多）；只修轉址不動 social（否——social_links 是本輪交付物，落空不可接受）。
- **影響**: crawler.ts、deep-extractor.ts、orchestrator.ts、social/discover.ts＋測試；修完 Connact AI 重跑驗證。

### 2026-07-13 14:05 | 使用者指示：擷取端與 HUD 合為同一視窗（一邊聽一邊看建議）
- **誰決定**: 使用者（看新首頁後指出：「這兩個功能應該要在同一個視窗才對，這才符合一邊聽一邊看建議的用法」）
- **決策**: 會中副駕的主要用法＝**擷取＋建議同一視窗**——/copilot 要同畫面顯示 HUD 的建議/研究卡流與批准互動，不是兩個分開入口各開各的。
- **與既有決策的關係**: 決策 14「HUD＝第二裝置」**不作廢、降為選配**——/hud 獨立頁保留（第二裝置鏡像）。帳號 B 的瀏覽器依會議模型永不被分享，HUD 嵌進擷取視窗**不違反 I3**。I2 批准 gate 不變（server 端驗證，見下則）。
- **考慮過的替代**: 無（使用者直接指示）。
- **影響**: /copilot 改組合視圖＋首頁/側欄文案；PRODUCT_SPEC 會中視圖敘述日後蒸餾。

### 2026-07-13 14:25 | 合併方案 A 拍板＋isPresenter role 裂縫修正（I2 面）
- **誰決定**: Fable（依 Opus 偵察證據）
- **決策**:
  1. **方案 A：同分頁雙 WS 組合視圖**——/copilot 改「會中副駕」cockpit：左窄欄擷取控制（原 CopilotInner）＋右建議流（原 HudInner），同讀 `mc_meeting_creds` 天然同會議，開 capture＋hud 兩條連線（hub 無同 user/role 連線上限，偵察證實）；單一 ToastProvider、單一 `<main>`；窄螢幕直向堆疊。/hud 獨立頁不動。
  2. **修 I2 既有裂縫**：偵察發現 `ws-server.ts:96` `isPresenter = userId===presenterUserId && role==="present"`，但 suggestion/info_card 只推給 hud role → **現行獨立 /hud 送批准會被 `forbidden_not_presenter` 拒**（CI 沒抓到＝authz 測試直打 patch.act 未經 ws-server；protocol.ts 與 API_CONTRACT §6 兩處註解自相矛盾）。**修正＝isPresenter 改純身分判定 `userId===presenterUserId`、去掉 role 條件**。安全論證：wsToken 由 presenter 建會議時鑄造、含 presenterUserId，役割(role)是連線時自選的 query param——任何持 token 者本就可自稱 present role，role 條件不構成安全邊界，只擋掉正當用法。修正後 I2 仍由「token 持有＋userId 比對」雙重把關（patch-service presenterAuth double-check 不動）。
  3. **驗證要求（硬規則 7）**：新增經 ws-server 的 authz 測試——presenter token＋hud role 批准=過；**非 presenter userId token（跨使用者/跨 org）任何 role=拒**；既有 server 測試全綠才收。
  4. **文案**：copilot.title zh「會中副駕擷取端」→「會中副駕」（en「Meeting Copilot」）；HUD 卡改「第二裝置鏡像（選配）」定位；首頁 liveNote 同步。API_CONTRACT §6 矛盾註解隨實作更正。
  5. **避讓**：TranscriptStream/globals 既有區塊/protocol.ts 只引用不修改（爬蟲 session W agent 領地）；globals 新樣式一律 `mc-cockpit*` 新 class 追加檔尾。
- **考慮過的替代**: 方案 B（合併視窗唯讀、批准留第二裝置）——否決：違背使用者「一邊聽一邊看**建議**」的單裝置核心訴求，且 role 裂縫放著不修等於 /hud 批准壞著；approval 改走 present role——否決：present 是被分享的乾淨舞台（I3），收不到也不該收建議流。
- **影響**: apps/web copilot/hud 元件重組＋messages＋HomeDashboard；apps/server ws-server.ts＋authz 測試（該檔不在爬蟲 session 檔案集，無衝突）；docs/API_CONTRACT.md §6。

### 2026-07-13 12:32 | /simplify 四鏡頭裁決：9 項套用、2 項跳過、1 項 backlog
- **誰決定**: Fable（依 reuse/simplification/efficiency/altitude 四路 opus 審查裁決）
- **決策**:
  1. **套用（行為不變清理，單一 apply agent）**：(a) 會中熱路徑 `collectWhitelist` 每分析窗 4 次序列 DB 讀→per-session 快取（順帶消除與 contactRoster 的重複讀）；(b) `resolveTrust` 逐 hit 序列查→Promise.all（≤3）；(c) 兩擷取器複製貼上的 `UncategorizedIntel` 型別＋去重迴圈＋narrativeZh 正規化三寫法＋WP2 schema/prompt 片段→抽共用模組；(d) `writeSingletonNotes` 冗餘 re-filter 移除；(e) deep-rounds 死參數 `includeSocial:false` 移除；(f) realtime/orchestrator magic `.slice(-6)`→復用具名常數；(g) **`social/http.ts` 逐字複製的 `pinnedAgent`→export `import/extract.ts` 原函式複用**（DNS-rebinding 防線單一來源，保留各自 timeout 值不變行為）；(h) 社群網域清單兩份→crawler 改用 `classifySocialUrl` 判別；(i) indexer contacts N+1（冷路徑）——僅在 list 已含所需欄位時順手改，否則保留並註記。
  2. **跳過**：YouTube `q()` 手刻編碼改 `URLSearchParams`（空白 `+` vs `%20` 非 byte-identical，對外部 API 引入等價性問題、收益極小）；`provenanceTypeFor` 死 `?? null` 分支（TS 嚴格模式產物，文件已註）。
  3. **backlog（不在本輪動）**：embedding entity_type 詞彙單一真相來源（indexer 字面值／retrieval kindOf／PROVENANCE_BASE_TYPE 三處分居兩模組）——altitude 鏡頭正確指出 code-review 修法位置偏低，但重寫剛驗過的 trust 面高風險，列 backlog 待下輪；同籃：entity 消失的孤兒 embeddings GC。
  4. altitude 鏡頭復查三個 code-review 修法：indexer 清殘留與 deep-rounds 預算閘「高度正確」，resolveTrust 僅位置問題（歸入 backlog 項）。
- **脈絡與理由**: 使用者指示補跑 /code-review＋/simplify（上輪制度）；四鏡頭無行為性 bug（與 /code-review 分工正確），全部為維護性/效能清理。
- **考慮過的替代**: 本輪就做 entity_type 單一真相來源（否——behavior-invariant 但動剛驗過的 trust 判定面，回歸成本＞收益，與上輪 ws.ts bandaid 同理列 backlog）。
- **影響**: research/**、realtime/**、import/extract.ts（加 export）；apply 後回歸 typecheck＋server 100 基線＋crm 49 基線。

### 2026-07-13 12:15 | /code-review 結果裁決：1 confirmed 全修＋2 個門檻下真 bug 升級修＋2 接受
- **誰決定**: Fable（依五鏡頭 workflow 審查＋逐 finding 對抗評分結果裁決；使用者指示補跑 /code-review＋/simplify）
- **決策**:
  1. **修（confirmed 82/80，bugs 與 consistency 兩鏡頭同時抓到）**：`realtime/retrieval.ts` 的 `resolveTrust` 用 embedding 的 entity_type（`company_card`/`contact_card`/`company_product_card`）查 `field_provenance`，但 provenance 存的是基底型別（`company`/`contact`）——exact match 永遠 0 列 → **trust='verified' 分支是死碼**，人工驗證過的資料在會中卡片上永遠顯示 crawler。修法＝embedding entity_type→provenance 基底型別對映（實際對映值以 repos-prospect 的 provenance 寫入為準）＋補「人工驗證欄位→卡片 verified」測試。
  2. **升級修（74/72 分，門檻下但兩鏡頭獨立抓到、驗證者確認為真）**：`research/indexer.ts` 重建索引只 upsert 新 chunk、不清高 index 舊 chunk——內容縮短跨 1000 字邊界後**過時情報殘留索引並可能在會中出卡**。深研究重跑是常態，資料陳舊直接傷「深與廣」價值 → 升級修：每 entity upsert 後刪 `chunk_index >= 新數量` 殘留列＋測試。
  3. **升級修（60 分，語意錯誤）**：`research/deep-rounds.ts` 的 `DEEP_RESEARCH_BUDGET_MS` 實為每輪軟 deadline、非註解宣稱的整場預算（多輪可放大數倍，僅靠 job timeout 兜底）→ runDeepRounds 維護整場 deadline（逾期不開新輪）＋更正 docstring。
  4. **接受不修**：Threads fetch 未接 AbortSignal（35 分）——fetchRaw 有 45s 硬上限＋保證 kill teardown，最壞超支 ~15s，修的侵入性大於收益。其餘 filtered 為同 finding 重複計分。
- **脈絡與理由**: 上輪教訓再次應驗——fresh-context 驗證 10/10 過後，code-review 仍抓到 confirmed 死碼 bug（驗收測「詞彙對上、檢索命中」，沒測「verified 徽章真的亮」）。門檻 80 是報告信心過濾器、非修復門檻——74/72 陳舊索引是真 bug 且傷核心價值，指揮官有權升級。
- **考慮過的替代**: 只修 ≥80（否——見上）；deep-rounds 只改註解不改行為（否——「整場預算」是操作者合理心智模型，行為該向文件靠）。
- **影響**: retrieval.ts、indexer.ts、deep-rounds.ts＋測試；修完復審→/simplify→最終回歸。

### 2026-07-13 13:10 | UI 換皮驗收：審圖通過＋5 項收尾範圍擴充＋本地環境事實
- **誰決定**: Fable（依對抗式驗證 workflow＋實機走查證據裁決）
- **決策**:
  1. **對抗式驗證結果採納**：4 鏡頭 raw 6 findings→反駁層過濾→confirmed 3 全修（rail 記憶閃跳改 useState lazy init、手機抽屜補 visibility 退出 Tab 序、resize 往返殘留補 matchMedia、順帶 .mc-shell 納 reduced-motion 護欄）；killed 3 不修（SlideEditor 粉漸層＝範圍外殘留記 backlog、圓角膠囊化經 CSS 夾制規則證明零視覺差、語言切換掉 query 因全站無 query-backed 路由不成立）。
  2. **Fable 親自審 10 張實機截圖：設計方向通過**（三階段 rail／mono kicker／LIVE 萊姆／側欄分組一致成形），核准 5 項收尾**範圍擴充**（超出原契約 7 檔白名單）：(a) AuthForm 輸入框套 .mc-input＋id/name/autocomplete（P0 第一印象）；(b) **登入成功落點 /crm→/**（新儀表板＝登入後首站）；(c) EN copilot.title 縮短救側欄截斷；(d) /train 補 main landmark；(e) .mc-empty__icon 升級 56px 圓形底座（全站空狀態受益）。
  3. **本地環境事實與處置**：:8787 被無關 bun app「fakechat」佔用、MeetCopilot API dev 慣例=PORT=8788 覆寫（.env 寫 8787 但被佔）；:3000 web dev 是 07-09 殘留殭屍（Jest worker 崩潰全站 500），分類器擋 kill（另一工作線可能依賴）→**另起 :3001 實例**（NEXT_PUBLIC_API_BASE=http://localhost:8788 對齊，消 CSP↔bundle 不一致）＋API 起 :8788。兩顆 next dev 共用 .next 有髒 chunk 風險，正解＝別並行同目錄兩顆 dev（:3000 殭屍待使用者裁決清理）。
  4. 截圖 agent 為讓 chrome-devtools MCP 可跑，建立可還原 junction `%LOCALAPPDATA%\Google\Chrome\Application`→Playwright Chromium（本機無 Chrome stable）；Fable 裁決保留供後續走查，已向使用者揭露，移除指令記在 junction 說明。
- **考慮過的替代**: 空狀態 icon 換整套插圖系統（否——CSS 底座即可救存在感，插圖列 UIUX brief 後續）；登入落點維持 /crm（否——儀表板就是為登入後首站設計的）。
- **影響**: apps/web AuthForm/en.json/train/globals.css；SlideEditor 粉漸層殘留＋空狀態插圖記 backlog；與爬蟲升級 session 以檔案集互斥並行（對方 W agent 動 EnrichPanel/NotesTab/HUD，messages 兩檔雙方皆只 Edit 追加）。

### 2026-07-13 11:52 | 對抗驗證 10/10 過＋整合修正輪範圍＋文件蒸餾
- **誰決定**: Fable（依驗證 agent 與 W 回報裁決）
- **決策**:
  1. **驗證結論採信**：fresh-context 對抗驗證 10/10 ✓（親跑 typecheck＋server 95/95＋crm 49/49；embeddings 詞彙 R/M 逐字對上；reindex/白名單授權攻擊測過；**live 冒煙真跑**——真 Gemini 爬 ghost.org 125s job done、兩單例筆記＋7 列 embeddings 全對）。
  2. **整合修正輪 4 項**（派單一 agent 收尾）：(a) shared `NoteType` 聯集補 `narrative`/`observations`＋移除 W 的字串 cast；(b) standard 擷取路徑 MAX_TOKENS 韌性——失敗重試一次、輸入內容減半，仍敗才 markFailed（deep 路徑本有容忍，standard 無→大站整 job 失敗，驗證 minor finding）；(c) `MAX_CRAWL_DEPTH` env 化（契約「皆可 env 覆寫」）；(d) deep-research.ts 過時註解修正。
  3. **接受不修的 nit**：`CRAWL_HARD_CAP_MS` 實為 clamp 常數、30 分鐘上限由 `CRAWL_DEADLINE_DETAILED_MS` 承載——.env.example 已誠實標註，重構命名收益低於風險。
  4. **追認 W 兩個規格判斷**：EnrichPanel 保留可選官網 URL 欄位（深度研究的起點種子，非模式選項，不違反「單一入口」）；移除二次確認 dance（面板已明示 30–60 分鐘）。
  5. **文件蒸餾**：00-DECISIONS 補「2026-07-13 補充拍板（決策 21–24）」節；API_FINDINGS 補 §G 社群平台節（指向 SOCIAL_CRAWL_FINDINGS.md）——依 MAINTENANCE：research/* 自由更新；00-DECISIONS 循 15–20 補充拍板節慣例純追加使用者已拍板事項。
- **考慮過的替代**: standard 路徑只加 try/catch 不重試（否——擷取是 standard 唯一產物，吞錯等於白爬，減半重試才有意義）；NoteType 改由 W cast 長期繞過（否——型別債，2 行可清）。
- **影響**: 整合修正 agent 交辦；00-DECISIONS、API_FINDINGS、（本則）ROM；修正完成後彙整 commit 提案給使用者。

### 2026-07-13 11:36 | R 路 6 gap 裁決批＋W 與驗證平行派工
- **誰決定**: Fable（依 R agent 回報裁決）
- **決策**:
  1. **reindex 路徑接受 `/api/research/companies/:id/reindex`**（契約字面是 `/api/companies/:id/reindex`，但 router 掛載檔不在 R 所有權、且 enrich 等研究端點本就在 research router）——W 與文件一律以實作路徑為準，不再要求動 index.ts。
  2. **social_links 落庫走 core.db＋provenance.record（orchestrator 內）追認**：避免動凍結接縫 ports.ts 的 CompanyRepository，沿 jobs.ts 的 sanctioned DbPort 慣例，零接縫變更。
  3. **ports.ts `NoteRepository.upsertSingletonNote` 純新增追認**（向後相容；noteType 用 raw string 避免動 shared NoteType 聯集）。
  4. **研究 tunable 維持「模組內讀 process.env」既有慣例**，僅 `YOUTUBE_API_KEY`（秘密）進 config.ts——契約「env 全由 R 改 config.ts」指所有權而非集中化，不另要求重構。
  5. **pg 方言 migration 013/014 本機無 Postgres 未驗**——接受，列入**部署 checklist**：上 Cloud SQL 前先冒煙（DEPLOY 流程時處理）。
  6. **Threads best-effort（撞 consent/login 牆即 skip＋log）確認**＝契約原意。
  7. **派工**：W（前端）即刻派出——換皮 session 正佔用 apps/web（layout/page/globals/AppShell/messages/home），W 檔案集與其互斥（EnrichPanel/NotesTab/HUD transcript/InfoCardStream），messages 兩檔**只准 Edit 追加、動手前重讀、嚴禁 Write 整檔**；同時平行派 fresh-context 對抗驗證（server 側 R+M 成果，不等 W）。
- **脈絡與理由**: R 完成全部驗收（typecheck 全綠、crm 49/49、server 95/95）；6 個 gap 全為「契約字面 vs repo 現實」的合理偏離，無一違反產品決策；兩 session 共用工作樹是現實約束，以檔案集互斥＋Edit 紀律管控。
- **考慮過的替代**: 堅持契約字面 reindex 路徑（否——要越權動 index.ts，收益只有路徑美觀）；等換皮 session 結束再派 W（否——W 檔案集可做到互斥，等待只是空耗）。
- **影響**: W 交辦 prompt、驗證交辦 prompt；DEPLOY 階段 checklist＋pg 冒煙；契約 v1.0 字面不改（偏離以本則為準）。

### 2026-07-13 11:13 | M 路 gap 裁決批（新訊號持久化／youtubeApiKey 選填／prompt 邊界追認／詞彙對齊）
- **誰決定**: Fable（依 M agent 回報的 4 個 gap 裁決；補充指令已 SendMessage 給仍在跑的 R agent）
- **決策**:
  1. **新訊號要持久化**（採 M 建議 A）：`meeting_signals` 的 CHECK 只列 9 類，`person_mention`/`topic_shift` 落庫會靜默失敗 → 由 R 加 **migration 014**（雙套）放寬 CHECK 至 11 類＋落庫/讀回測試。否決 B（僅會中即時、不持久化）——會後回顧需要完整訊號帳。
  2. **`config.ts` `youtubeApiKey` 改選填**：R 原加必填導致 4 個不在任何人所有權內的測試 fixture typecheck 掛掉；缺 key＝優雅 skip 本來就是契約行為，選填是正確形狀（也免動 4 個測試檔）。
  3. **追認 M 動 `analysis/gemini-analysis.ts` SYSTEM prompt**：該檔在 M 所有權清單外，但契約 §4.2 明定「分析 prompt 同步更新」為 M 職責、不改則新訊號功能死；只動一處 prompt 字串，越界可接受，後續該檔歸 realtime 維護面。
  4. **embeddings entity_type 詞彙以 M 為準**：契約凍結了 chunk 來源但漏凍字面值 → 指令 R 寫 indexer 時對照 `realtime/retrieval.ts` 的 collectWhitelist/kindOf 詞彙（唯讀對照、不得改 M 檔），對不齊回報不得各寫各的。
- **脈絡與理由**: M 路完成（server 79/79、CRM 46/46、6 新測試），守「回報 gap 不自創」規矩沒有變通，4 個 gap 全數上呈——契約漏洞（CHECK 清單、entity_type 字面值）由指揮官補裁，避免 R/M 各自假設漂移（L5 教訓的正確運作範例）。
- **考慮過的替代**: 見各項否決註記；另考慮過整合階段才修 youtubeApiKey fixture（否——改選填一行解決，不用碰 4 個測試檔）。
- **影響**: R 任務追加三項（migration 014、config 選填、詞彙對齊）；契約 v1.0 不改版（裁決以 ROM 為準，整合驗證時一併檢查）。

### 2026-07-13 10:48 | 爬蟲專輪路線拍板：Meta 走 grounding-only＋深研究 30–60 分鐘級＋Fable 設計契約
- **誰決定**: 使用者（兩項 AskUserQuestion 拍板）＋Fable（執行層設計批）
- **決策**:
  1. **使用者拍板 A——Meta（FB/IG）取得路線＝只用 Gemini grounding**：靠 Google 索引（2025-07-10 起索引 FB/IG 公開專業帳號）間接取得，零新增成本與帳號；**不接 Apify** 第三方（日後深度不夠可再升級）；自建 Playwright 爬 FB/IG 亦否決（反爬最兇＋零 stealth 起步）。Threads＝自建無登入 Playwright 爬公開頁；YouTube＝官方 Data API v3（**前置：使用者需開一把免費 YOUTUBE_API_KEY**）＋Gemini 原生 YT URL 理解。一律不做登入態爬取（ToS/封號）。
  2. **使用者拍板 B——單公司深研究天花板＝30–60 分鐘級**：多輪迭代研究（grounding 追問 2–3 輪）＋官網深爬頁數大幅放寬＋四平台社群，全部 env 可調；token 成本靠 admin 用量儀表板追蹤。否決「數小時級研究到乾」與「維持 10 分鐘級」。
  3. **Fable 設計批（契約凍結於 `docs/RESEARCH_UPGRADE_CONTRACT.md` v1.0，要點）**：
     - 社群來源＝YouTube/Threads 做 `SocialFetcher` 產統一 `SourceText` 注入 DeepResearchBundle（[S#] provenance 自動繼承）；FB/IG 做成 deep 研究的社群 grounding 查詢模板集（不做 fetcher）；帳號發現＝官網爬取抽 social 連結＋grounding 查官方帳號，落 `companies.social_links`（migration 013 雙套）。
     - 筆記區＝沿用多型 `notes` 表，兩個**單例** AI 筆記 per company：`narrative`（zh-TW 平鋪直敘公司型態與狀況、pinned）＋`observations`（未歸類情報 bullet list、每條帶來源 URL），以 (org,company,note_type) 冪等 upsert；extractor schema 加 `narrativeZh`＋`uncategorized[{text,sourceIndex}]`，prompt 明令不准丟情報。
     - 深廣預算重設（env 預設）：CRAWL_HARD_CAP_MS 300s→1800s、MAX_CRAWL_PAGES 28→150、MAX_CRAWL_DEPTH 2→3、DEEP_RESEARCH_BUDGET_MS 150s→1200s、RESEARCH_JOB_TIMEOUT_MS 600s→3600s、新 DEEP_RESEARCH_ROUNDS=3（無新事實提早停）＋SOCIAL_FETCH_BUDGET_MS=600s。UI 拿掉快速/標準選項、deep 成唯一研究入口（standard 保留給 URL 匯入內部用）。Cloud Run 長 job 需 CPU always-allocated——寫入 DEPLOY.md 註記，部署時處理。
     - 會中消費＝補嵌入管線（research job 收尾建索引 `buildCompanyIndex`＋手動 `POST /companies/:id/reindex`）；檢索白名單擴 notes/products/news；signals 加 `person_mention`/`topic_shift`；說話者 wire enum 不變、加選填 `speakerLabel`（LLM 帶 CRM contacts 名單推斷多人）；CRM 補充卡沿用既有 InfoCard 形狀。
     - 派工＝3 路平行（R：research 引擎／M：realtime 會中／W：web 前端），檔案所有權互斥防衝突，config.ts 只歸 R、protocol 只歸 M；完成後另派 fresh-context 對抗驗證（含攻擊者憑證測 /reindex）。
- **脈絡與理由**: 4 路偵察證實——嵌入管線生產未實作（索引空→會中 CRM 卡端到端不出）、schema 外情報被靜默丟棄、deep bundle 有天然社群插入點、FB/IG 自爬不可行。使用者選最低成本 Meta 路線與中檔深度預算。
- **考慮過的替代**: Apify（否決——使用者選 grounding-only）；notes 另開新表（否決——多型 notes 表＋NotesTab 已上線，加 note_type 即可）；每條未歸類情報一筆 note（否決——表膨脹，改單例 bullet list）；把嵌入建索引放 M（否決——落庫收尾在 R 的 orchestrator，避免跨 agent 同檔）。
- **影響**: 新契約檔 RESEARCH_UPGRADE_CONTRACT.md；apps/server research/realtime、migration 013、apps/web；API_FINDINGS 待補社群節指標（收尾做）；00-DECISIONS 待實作驗證後蒸餾補列。

### 2026-07-13 11:20 | 首頁重設計＋全站換皮設計契約（側欄 Shell、參考 ezpage）
- **誰決定**: 使用者（三項指示）＋Fable（設計拍板）
- **決策**:
  1. **使用者指示**：(a) 首頁醜、重設計——左側改可收折（漢堡）導覽欄、右側大區域顯示內容；(b) 整體 UI 用 frontend-design skill 重設計；(c) 先本地看過才部署；(d) 重申工作型態＝Fable 指揮官、Opus 執行（實作也派 Opus，Fable 只做決策）；(e) 參考 `Desktop/ezpagesite` 的前端設計。
  2. **Fable 設計拍板**（完整契約見 session scratchpad `design-contract.md`，要點）：
     - **深色「會議控制室」語言**：保留品牌紫 `#8b5cf6` 為主色（品牌連續性＋studio/present 共用 token 風險最低）；**廢除紫→粉漸層**（AI 感最重的元素），`--mc-accent-2` 從粉 `#ec4899` 改靛藍 `#6d7cff`；引入極少量萊姆 `--mc-hi #d8f651` 當「live 訊號色」簽名點綴（live kicker 圓點/首頁 rail 脈衝/live 狀態）。
     - **ezpage 移植手法**：token 分層（panel/card/elev/field＋r-sm/md/lg 圓角刻度）、主按鈕 hover 上浮＋色影、輸入框聚焦光環、側欄選中態＝低透明紫底＋內光、mono kicker（Geist Mono via next/font）。
     - **Shell**：AppShell 從 TopBar 改 248px 側欄（rail 64px 可收折、localStorage 持久、<880px off-canvas＋scrim）；導覽按會議生命週期分組（工作台／會前準備／會中進行／對練／管理），**present/copilot/hud 一律另開分頁**（無 chrome 獨立介面）；補語言切換器＋修硬編碼「登出」。
     - **首頁**：改為 AppShell 內儀表板；簽名元素＝三階段流程 rail（PRE→LIVE→DRILL，萊姆光點巡航，reduced-motion 護欄），6 個 surface 卡就位各階段；會中組帶雙帳號提示文案。**首頁因此納入 AuthGuard＝未登入導 /login**——邀請制 SaaS 正確行為，且消掉舊首頁公開曝露 present/copilot/hud 連結的 I3 縱深風險（UIUX_DESIGN_BRIEF §三本有此要求）。
     - **收斂債一併清**：死 token `--mc-surface-2` 補定義、圓角 5 種值收斂 3 檔、重複 keyframes 去重、硬編碼輸入底色 token 化、首頁 metaTitle＋icon.svg favicon。
- **考慮過的替代**: (a) 換成 ezpage 的淺色白底藍——否決：present/HUD/studio 深色且共用 token，淺色化波及簡報視覺、風險大；(b) 主色跟著 ezpage 換電光藍——否決：紫是既有品牌識別，deck 主題沿用中；(c) 首頁維持裸頁不進 AuthGuard——否決：brief 目標 IA 就是登入後儀表板，裸頁還曝露 I3 面。
- **影響**: apps/web（globals.css/AppShell/首頁/messages/layout 字體/icon.svg）；I3 三頁不動；studio-present.css 不動（token 耦合面由實作 agent 回報）。實作/驗證/截圖全派 Opus；本地過目後才 commit＋部署（硬規則 10）。

### 2026-07-13 10:33 | 爬蟲擴社群媒體＋CRM 筆記區＋深廣優先＋會中 CRM 補充資訊（使用者四項指示）
- **誰決定**: 使用者
- **決策**:
  1. **研究爬蟲要能爬社群媒體**——FB、IG、Threads、YouTube（現況大多只爬官網）。
  2. **CRM 加「筆記區」**：結構化欄位歸類不進去的情報，不可丟棄——讓 AI 用平鋪直敘的文字描述該公司的型態與狀況。
  3. **爬蟲定位＝深與廣**：時間不是問題；明確**不需要**「快速爬蟲」這個概念（現行 CRAWL_HARD_CAP_MS 5 分鐘硬上限、RESEARCH_JOB_TIMEOUT_MS 600s 與此方向衝突，執行層需重新設計時間預算）。
  4. **會中補充資訊要 based on CRM**：依與客戶交談的內容（注意**雙方可能各不只一位**）顯示補充或額外資訊。
  5. **重申工作型態**（2026-07-07 拍板之重申）：Fable＝指揮官，指揮 Opus 等效能較低的 agent 做事；指揮官不下場讀程式碼。
- **脈絡與理由**: 2026-07-09 已立案「爬蟲效果不如預期」（當時拍板＝先記錄、等 admin job 監控有數據再專輪處理）；本次使用者直接給出專輪方向——來源面擴到社群媒體、產出面補「裝不下的情報」的敘事筆記區、時間預算放開換取深廣、會中消費端要真正把 CRM 用起來。
- **考慮過的替代**: 無（使用者直接指示；執行層方案待 4 路 Opus 調查回報後另記）。
- **影響**: 待調查後定案——預期涉及 apps/server 研究引擎（orchestrator／crawler／deep-researcher／extractor 與時間上限 env）、CRM schema（筆記區）、會中訊號分析與 HUD 消費端；社群平台 API 事實照規矩先查證不猜（API_FINDINGS 需補社群節）。00-DECISIONS 待設計定案後再蒸餾補列。

### 2026-07-09 14:10 | 驗收收尾：兩個 P2 邊角取捨接受＋WORKLOG 歸檔
- **誰決定**: Fable（對抗式驗收 12/12 CONFIRMED-OK 後的殘項裁決）
- **決策**: (1) **接受** WS 停權閘 fail-closed 取捨——DB 短暫錯誤會 close 4003 斷正常連線，屬 per-connection、重連即恢復，安全性優先；(2) **接受** ASR 記帳冪等 key 邊角——session 完全 dispose 後同 meetingId 復用時 seq 歸零撞舊 key＝**少計不重計**（對使用者有利方向），日後要精確可在 key 加 runtime epoch；(3) WORKLOG 依 MAINTENANCE 三節歸檔（150→56 行，8 節移 `docs/archive/WORKLOG-2026-07-06_08.md`，byte-exact 驗證）。
- **考慮過的替代**: fail-open 停權閘（否決：停權形同虛設）；立刻加 epoch 進 ASR key（否決：改動熱路徑換取邊角精度，收益低於風險）。
- **影響**: 無程式改動；WORKLOG/archive 結構變更。

### 2026-07-09 12:40 | ADMIN_CONTRACT v1.1 凍結＋實作排程取捨（Fable 設計決策批）
- **誰決定**: Fable（依使用者 11:45 拍板的範圍執行設計）
- **決策**:
  1. **`docs/ADMIN_CONTRACT.md` v1.0→v1.1 凍結**：平台管理員＝`PLATFORM_ADMIN_EMAILS` env allowlist＋JWT `platformAdmin` 旗標（同 `JWT_SECRET`，v2 再隔離）；migration 012（orgs.status／users.status／usage_events.user_id，SQLite＋PG 雙套）；補四個記帳缺口（ASR／gemini_live／會中分析改 metered／pricing env 覆寫落地）；9 個 `/api/admin/*` 端點形狀全部定死；apps/admin 六頁純 CSS＋自繪 SVG、zh-TW 單語、dev port 3100；CORS 改 allowlist（WEB_ORIGIN＋ADMIN_ORIGIN）。新增不變量 **A1**（admin 路由對非 admin token 必 403）／**A2**（read-mostly，唯二寫入＝org/user 停權復權）／**A3**（不回傳秘密）。
  2. **ezpage 解剖的吸收面**：驗證模式同構（印證不改）；UI 借模式不借棧（KPI 卡 sparkline／StatusBadge／job 監控頁；不引 Tailwind/recharts/TanStack）；cost-estimator、digest 遙控部署頁、HttpOnly cookie 列 v2 backlog。
  3. **實作排程＝兩半場**：先跑「非干擾」半場（apps/admin 前端＋migration 012＋Dockerfile.admin/cloudbuild-admin/DEPLOY 增補——不動 apps/server/src，避免觸發本機 dev server 熱重載干擾 UI/UX 自測）；等 UI/UX 自測瀏覽完成後才跑 apps/server 半場（admin routes／jwt／CORS／metering）＋verify。
  4. **UI/UX 自測跑本機不跑 production**：HEAD 較新、可自由造測試資料、不汙染線上；本機 dev 由專責 agent 啟動並建測試帳號。
- **考慮過的替代**: (a) admin 用獨立 ADMIN_JWT_SECRET——延後 v2（單操作者 MVP 不值多一組密鑰管理）；(b) admin 前端沿用 ezpage 的 Tailwind+recharts——否決：與 repo 純 CSS 慣例衝突、多三個依賴面；(c) 服務端先行、前端後行——否決：服務端改動會干擾自測，前端先行可與自測平行。
- **影響**: docs/ADMIN_CONTRACT.md（新檔）；後續 migration 012、apps/admin、Dockerfile×3、cloudbuild-admin.yaml、DEPLOY.md、apps/server（下半場）。

### 2026-07-09 11:45 | v1/v2 徹底合一＋admin 後台立項（形態/範圍）＋UI/UX 與爬蟲處理順序
- **誰決定**: 使用者（AskUserQuestion 兩輪拍板）＋Fable（執行路徑設計）
- **決策**:
  1. **徹底合一**：本機 v1 移除（內容先移 `Desktop/MeetCopilot_v1_archive` 待使用者最後確認刪）；GitHub v1 repo 改名封存 `MeetCopilot-v1-archive`；v2 全量遷入 `c:/Users/Martin/Desktop/MeetCopilot`（原 `MeetCopilot_v2` 目錄消滅）；以合一後資料夾新建 private repo `MarinChen99097/MeetCopilot` 並 push（推前 Opus 秘密掃描 PASS：追蹤檔零金鑰、.gitignore 覆蓋完整）。
  2. **admin 後台＝獨立 app**：monorepo 新增 `apps/admin`，部署為第三個 Cloud Run service；第一版四塊全做——token 花費儀表板（地基＝usage_events）／帳號管理（跨 org）／研究 job 監控／系統健康頁。參考 ezpage `LandingAI_admin_console`。
  3. **UI/UX**：全面自測（瀏覽器實跑全頁面）→壞點清單→先快修可用性→再寫給 claude design 的完整需求 md。
  4. **爬蟲品質**：先立案記錄，等 admin job 監控上線有數據後再專輪處理。
  5. **模型分工重申**：Fable 決策/立規、Opus（或更低）執行（沿用 2026-07-07 拍板）。
  6. 使用者另核准：終止本機殘留 v2 server（PID 11332、port 18787，cwd 鎖住 apps/server）；v1 未 commit 誤修殘留丟棄（已備份 session scratchpad `v1-uncommitted-backup/`）。
  7. **Fable 決策**：把使用者既有立規「commit／部署前先問」（2026-07-08 ROM＋記憶，原只寫進 v1 CLAUDE.md 硬規則 6）同步進本 repo CLAUDE.md 為硬規則 10，並修正硬規則 2 的「立刻 commit」措辭衝突——這是同步既有使用者規則，非新規。
- **脈絡與理由**: 使用者四大痛點：爬蟲效果不如預期、token 花費不明、UI/UX 醜且多處不可用、v1/v2 並存混淆（2026-07-08 曾因此誤修 v1）。
- **執行細節（Fable 取捨）**: v1 資料夾根目錄被 VS Code 工作區鎖住無法改名 → 改「內容置換法」：先清出 v1 內容再把 v2 內容 move 進原路徑，資料夾本體不動；`packages`／`apps/server` 兩處子樹鎖分別由 TS server 監看與殘留 server cwd 造成，逐層 move＋終止行程解決。git 歷史完整（HEAD 1e4bf76）、工作樹乾淨。
- **考慮過的替代**: (a) 只刪本機 v1、保留 `_v2` 名稱——否決：名稱混淆正是痛點；(b) admin 整合進 apps/web 的 /admin——否決：管理與客戶介面同一 build 隔離弱；(c) UI/UX 只修使用者指定壞點——否決：使用者選全面自測。
- **影響**: 本 repo 從此有 origin（`MarinChen99097/MeetCopilot`）；路徑引用需同步（CLAUDE.md／00-DECISIONS §19-1／ARCHITECTURE_PLAN 樹狀圖／memory）；後續里程碑＝UI/UX 自測快修→apps/admin→skills/SOP 搬運→部署文件補第三 service→設計需求 md。

### 2026-07-08 22:40 | extract-url 匯入加固全數做在 v2 並上線（P1 已部署、P2/P3 待部署）＋commit/部署前先問
- **誰決定**: 使用者（回報 bug、拍板「所有問題都在 v2」、核准 P1 上線、指示「1 3 修一修」）＋Fable（設計/範圍/實作取捨）
- **脈絡與理由**: 使用者回報 DeckWizard「從網址匯入」回 429。**過程踩坑**：session 工作目錄指向 `c:\...\MeetCopilot`（v1 參考件），Fable 誤在 v1 修了一整輪（UA/charset/429/DNS＋稽核 15 項＋審查 remediation＋worker）並 push 到 GitHub `MarinChen99097/MeetCopilot`，才在處理「部署」時查 GCP 發現 **live 是 v2（Cloud Run＋Cloud SQL）**、v1 未部署。使用者明確：「早就不管 v1 了，所有問題都是在 v2 發生的」。故全部改在 v2 重做。
- **決策**:
  1. **修復目標一律 v2**：v1 完全不管；v1 的修復只當「已驗證藍本」移植進 v2（v2 extract.ts 早期從 v1 移植後已分歧，須對齊 v2 契約重寫，不照搬）。
  2. **P1（extract.ts 6 項）先上線**：瀏覽器 UA／charset 解碼／十六進位 entity 防崩／429 重試／DNS 逾時／pdf `{max:50}`；**v2 更強的 SSRF/DNS-pin 逐字保留**。已 commit `5538ddd`、只重建 server、部署 rev **00009-qcb**、health/ready 200。
  3. **P2/P3 續做（本筆）**：P2＝gemini per-call 逾時＋finishReason≠STOP 可行動錯誤＋withRetry 退避/Retry-After/retryable 短路＋decks 錯誤映射（不外洩 raw）；P3＝pptx 串流位元組上限（取代可繞過的宣告大小檢查）＋parse 移進可 terminate 的 worker_thread＋ASR 真失敗廣播 `asr_unavailable`（去重、成功即清、空白不報）＋webp 匯出排除（畫面仍可 webp）。
  4. **實作取捨**：(a) worker 載入因 Node 22.18 原生 strip-types 頂掉 worker 內 tsx，改 **dynamic import 帶副檔名＋workerData 傳 ext**（dev/prod 皆實測過）；(b) webp **只在匯出 sink 排除、不動 shared 驗證器**（畫面預覽保留 webp）；(c) ASR 去重旗標放在 **per-session GeminiAsrProvider**（＝等同 per-runtime）、不廣播「已恢復」；(d) GenerationEmptyError→422（內容問題而非 502）。
  5. **commit／部署前先問**（使用者立規、已寫進 v1 CLAUDE.md 硬規則 6＋記憶）：寫完只回報＋擬 message，不自行 `git commit`/`git push`/`gcloud` 部署；追加 WORKLOG/CHANGE_TRACKER/ROM 不算 commit。
- **考慮過的替代**: (a) 把 v1 已 push 的成果直接視為交付——否決：live 是 v2，v1 修了production 不受惠；(b) P3 只做 pptx 串流上限、不做 worker——保留為選項但使用者要「修一修」故一併做（worker 為同步 CPU bomb 真正可硬性中止的唯一解，v1 已證可行）；(c) webp 直接從 shared 驗證器刪除——否決：該驗證器畫面/匯出共用，刪了畫面也不顯示 webp。
- **影響**: apps/server（gemini/pptx-parser/asr/realtime-hub/generation-pptx-render/decks-routes＋新 import/run-in-worker、parse-worker）。全 workspace typecheck 綠、server 36/36＋CRM 43/43 pass、逐 cluster fresh-context read-back PASS。**部署待使用者同意後**（只重建 server）。I1/I2/I3 未削弱、SSRF 未動。
- **注意**: v2 無 GitHub remote（純本機 git＋Cloud Run），與 v1（有 origin）不同。v1 那套修復留在 GitHub 當參考，不再維護。

### 2026-07-08 20:30 | 「研究此公司」URL 可選＝無 URL 就以公司名稱做全網深度研究（＋job 逾時）
- **誰決定**: 使用者（「這邊邏輯有問題，當他說『可選』時，好歹要藉由公司名稱去做深度研究才對」；且新建無官網公司 CyP 留空 URL 研究跑很久沒結果）＋Fable（設計）
- **根因**: orchestrator createJob 對**所有模式（含 deep）**在無 url 時 throw「no URL to crawl」；但 DeepResearcher 本就以 company.name 為 grounding 種子、domain/startUrl 皆 optional——根本不需 url，只是被這行擋在門外。且整個 job 無逾時＝卡住永遠「研究中」。
- **決策**:
  1. **無可爬 url 的 company → 一律以公司名稱走全網深度研究**（grounding by name，跳過官網 crawl）；有 url 才照 mode 爬官網。等於「URL 真正可選」。
  2. **整體 job 硬逾時** RESEARCH_JOB_TIMEOUT_MS（預設 360s，Promise.race）→ 逾時 markFailed 記「研究逾時」，job 狀態必終結。
  3. name-based 需 grounding+LLM（正式環境已設 GEMINI）；缺則清楚報錯而非默默卡住。
- **考慮過的替代**: (a) 無 url 就報錯要使用者補網址——否決：使用者明確要「用公司名稱研究」；(b) 只有 deep 模式支援無 url——否決：quick/detailed 留空也應退回名稱研究（mode 只是標籤，無 url 時官網爬不動）。
- **限制**: name-based 較耗（跑 grounding+合成）＝即使選 quick，無 url 也會走深度；共用品牌名消歧仍不完美（沿用 deep 既有限制）。逾時採 Promise.race 使 job 狀態終結，背景殘工在單一實例上自然結束（可接受）。
- **驗證**: typecheck 4ws 綠、server 36/36、CRM 43/43；親自讀回 orchestrator 逾時/createJob/分派/runDeep 四段確認。I1/I2/I3 未觸及。
- **注意**: 舊卡死 job（前一版建立）狀態不會自動變——使用者需重整重跑；未做 boot-time stale-job 清理（列為後續可選）。

### 2026-07-08 19:30 | CRM 顯示原文＋zh-TW 簡介、擷取在地化、補技術棧/部門孤兒表
- **誰決定**: 使用者（截圖 CyberPower 頁反映三點：「表現形式應該原文+i18n 簡介才對」「爬出來全英文沒翻成 i18n」「技術棧與部門也沒爬出來」）＋Fable（設計契約）
- **決策**:
  1. **原文＋zh-TW 簡介並排**（非取代）：DB 各加平行 `*_zh` 欄（news title/summary、product one_liner/description、company description、contact title/background_summary），原文欄照舊逐字，額外存 zh-TW 簡介；前端 locale===zh-TW 且 *Zh 有值時，於原文下顯示視覺區別的「🌐 中文簡介」框。
  2. **在地化放擷取階段**（非讀取時即時翻譯）：擷取器一次產出雙語（SYSTEM 從「do not translate」改為「主欄逐字＋*Zh 產 ≤2 句 zh-TW 簡介」）——省成本、可快取、有 provenance、離線可讀。
  3. **技術棧/部門是合成資料，直接產 zh-TW**（不需雙語欄）；補上擷取 schema（techStack/departments）＋orchestrator 呼叫既有 bulkUpsertTech/bulkUpsertDepartments，接上「有表有 repo 有讀路由有 UI 卻從無寫入」的孤兒表。
- **根因（調查確認）**: company_tech/company_departments 自 003 就有表＋repo＋GET＋前端分頁，但**沒有任何擷取器產出、orchestrator 也從沒呼叫 bulkUpsert**＝只讀得到永遠空。且兩擷取器 prompt 都明令 do-not-translate＝內容全來源語言、schema 無任何 zh 欄。
- **考慮過的替代**: (a) i18n map（Record<locale,string>）欄——否決：只有 zh-TW/en，平行純量 `*_zh` 最簡且足夠；(b) 讀取時即時翻譯——否決：延遲/成本/無 provenance；(c) 批次回填既有資料——否決：改走「使用者重跑研究即現」，避免一次性翻譯 job。
- **範圍/限制**: 只影響**新研究結果**，既有 CyberPower 資料需重跑「研究此公司（深度）」才會出現新欄位；大型產品目錄每產品多出 *Zh 可能逼近 16384 output token 上限（簡介有界故風險低，deep-extractor 有 3 次重試救 truncation）。
- **驗證**: typecheck 4 workspace 綠、server 36/36、CRM 43/43（idempotency 測試改連續 1..N 不硬編碼版本數）。I1/I2/I3 未觸及。migration 011 雙份（SQLite 多條 ADD COLUMN／PG ADD COLUMN IF NOT EXISTS），server boot 自動套。

### 2026-07-08 18:00 | 研究引擎不再鎖公司網域＝新增全網深度研究（deep 模式）
- **誰決定**: 使用者（「應有專門 agent 深度搜尋公司資料，公司網址只是起點，要去報導/wiki 等全網找，不要被鎖死在公司網址」）＋Fable（設計）
- **決策**: enrich 新增 **deep 模式**——專門的全網研究：以公司名/網址為起點，Gemini Google Search 多角度雙語查詢＋深讀外部來源（新聞/維基/產業/公開資料，跳過公司網域）＋綜合填 CRM，**關鍵＝每欄 provenance 指向真實外部來源 URL**（不是公司網域）。既有 quick/detailed（爬公司網站）不變；deep 額外並行網站爬蟲補產品。GroundingProvider（原只接 HUD /ground）現也接進 enrich。
- **考慮過的替代**: agentic 迭代 loop（Gemini 自行決定後續查詢）——第一版用結構化多查詢（可靠有界），迭代式列為後續。
- **實測（碩天科技/CyberPower）**: 從 FT/Wikipedia/cnyes/digitimes/businesswire 撈到 11 概況+5 新聞+6 主管+10 競爭對手，員工數 1730←FT、董事長郭瑾←Wikipedia，附真實出處。~$0.013/次。
- **誠實限制**: 共用品牌名跨實體消歧不完美（CyberPower TW UPS vs 美國電競 PC，6 主管有 2 疑錯實體）；redirect 解析 best-effort；LLM 合成非決定性（已修 JSON runaway）；找不到私有/付費牆/未索引資料。
- **新 env**: DEEP_RESEARCH_BUDGET_MS(150s)/MAX_QUERIES(9)/MAX_SOURCES(6)；migration 010（crawl_jobs.mode 加 deep，server boot 自動套）。
- **影響**: research 全模組、CRM provenance sourceType、web EnrichPanel；需重建 server image 重部署（migrate() boot 套 010）。

### 2026-07-08 14:30 | 帳號互通＝Google 登入（沿用 EZpage client）＋爬蟲放寬
- **誰決定**: 使用者（要跟 EZpage 帳號互通；澄清 EZpage 純 Google 登入無密碼；沿用同 OAuth client；爬蟲慢沒事）＋Fable（設計）
- **決策**:
  1. **共用帳號＝Google 登入**（非密碼代理）：EZpage 只用 Google，故 MeetCopilot 也做 Google Sign-In，用同一個 Google email 對接＝同身分。零 secret 共用、零改 EZpage、零改 MeetCopilot schema（用既有 provision 邏輯 by email）。沿用 EZpage 的 OAuth client id `54139295474-f7cve65n...`（client id 非機密）。feature flag 保留本地登入給 dev。中途兩個 agent（email 密碼代理、爬蟲）被使用者停掉——採用其已落地且 typecheck 綠的爬蟲碼，Google 登入改由新 agent 正確實作。
  2. **爬蟲「慢慢爬沒事」**：nav 60s、quick deadline 120s、detailed 300s，全 env 可覆寫但仍有界（L13）；逾時不硬敗、搶救部分內容。
- **使用者行動項（唯一）**: Google Cloud Console 把 `https://meetcopilot-web-54139295474.asia-east1.run.app` 加進該 OAuth client 的「已授權 JavaScript 來源」（gcloud 改不了、只能 Console），否則 Google 不發 token。
- **部署**: 需重建 server image（爬蟲＋auth 碼）＋設 GOOGLE_CLIENT_ID env；重建 web image（bake NEXT_PUBLIC_GOOGLE_CLIENT_ID）。
- **影響**: server auth/config/crawler、web auth/CSP、.env.example、DEPLOY 重部署要加 GOOGLE_CLIENT_ID。

### 2026-07-08 03:00 | ✅ 上線 GCP 完成 — MeetCopilot v2 live
- **誰決定**: Fable（執行部署；使用者授權「直接部署到 GCP、同 ezpagesite 專案」）
- **決策/結果**: **已實際部署到 GCP ezpagesite 專案並驗證**——server `https://meetcopilot-server-54139295474.asia-east1.run.app`（Cloud Run min=0/max=1/cpu2/ram4/gen2/CloudSQL/WS3600/session-affinity；/health+/ready 200；register→me 端到端過、資料寫進 Cloud SQL）、web `https://meetcopilot-web-54139295474.asia-east1.run.app`（min=0/max=2；i18n 307→/zh-TW、login 200、CSP 指向 server https/wss+Gemini Live）、Cloud SQL Postgres16 `meetcopilot-db`、4 Secret、Artifact Registry server+web 影像。
- **執行過程/坑**: provisioning agent 建好 Cloud SQL+secrets+推 server 影像，但反覆卡在 async-build 等待迴圈→**Fable 接手親自驅動剩餘 Cloud Run deploy**。Cloud Build 失敗根因＝monorepo `tsc -b` 乾淨 Linux 誤判 mtime（TS6305→@meetcopilot/shared 解析失敗 cascade implicit-any）→改 crm/server build tsconfig 為 `tsc -p`+paths→dist .d.ts（commit 99a98e4）。web 的 NEXT_PUBLIC_API_BASE build-time bake 走 cloudbuild-web.yaml。
- **成本**: 閒置約 $8–12/月（Cloud Run→$0、Cloud SQL 常態 ~$8–10）。
- **仍待使用者**: OpenAI 組織驗證（生圖）、真語音/麥克風瀏覽器實測、自訂網域（可選）。max>1 需 Redis 外部化 session。
- **影響**: docs/DEPLOY.md 加實際上線章節+重部署指令；cloudbuild-web.yaml。**MeetCopilot v2 從規劃到上線全程完成（M0–M5＋code-review＋Postgres 移植＋GCP 部署）。**

### 2026-07-08 11:35 | 部署路線定案：Cloud Run(min=0/max=1)+Cloud SQL Postgres；Postgres 移植完成
- **誰決定**: 使用者（要 scale-to-zero autoscaling＋「可以創一個 SQL 資料庫」）＋Fable（架構裁決）
- **決策**:
  1. **改上 Cloud Run + Cloud SQL Postgres**（取代原決策 20 的 GCE 單 VM+SQLite）。理由：使用者要 scale-to-zero（min=0）經濟性，SQLite 在 Cloud Run 短暫 FS 會掉資料→必須 Cloud SQL。**Cloud Run 自帶 *.run.app HTTPS**→網域/TLS 問題消失（secure context 免費，麥克風/Live 可用）。
  2. **max=1 硬約束（非使用者說的 2）**：會中副駕 session 狀態在單進程記憶體＋WS 長連線，多實例會拆散會議。min=0/max=1 給 scale-to-zero 又正確；max>1 需未來 Redis 外部化 session。cpu=2/ram=4 OK。
  3. **成本誠實**：Cloud Run compute 閒置→$0，但 **Cloud SQL 本身不 scale-to-zero**（最小 db-f1-micro 約 $8–10/月常態底）。仍遠低於 e2-medium 常開 VM（$27）。若要連 DB 都 $0 idle＝Neon 等第三方 serverless PG（非 GCP 原生，使用者要的是同 ezpagesite 專案故用 Cloud SQL）。
  4. **Postgres 移植完成並驗證**：雙驅動（不破 SQLite）、crm 43/43 兩 DB 皆綠、真 server 在 pg 端到端。
- **考慮過的替代**: GCE 小 VM+SQLite+排程停機（幾乎零工程但非真 autoscaling；使用者選了 SQL DB 路）；Neon serverless PG（$0 idle 但非 GCP 專案內）。
- **影響**: packages/crm 雙驅動、apps/server crm.ts；接著 provision Cloud SQL＋Cloud Run（ezpagesite 專案）＋deploy 2 服務（server/web）。ARCHITECTURE 部署節與決策 20 更新為 Cloud Run 路線。

### 2026-07-08 09:05 | M5 PASS — 整個產品 M0–M5 完成（含誠實 gap）
- **誰決定**: Fable（依全鏈路整合驗收裁決）
- **決策**:
  1. **M5 驗收 PASS 入庫**：全鏈路 fresh-context smoke 8/9 PASS——隱私（同意閘/PII 遮蔽實測遮罩/persist=0 逐字稿 0 落 DB）、成本（usage rollup 跨 org 隔離）、強化（/ready、限流 429、安全標頭、log 0 洩漏）、邀請（invite→accept＋跨 org 隔離）、I1/I2（append-only＋非 presenter 被拒）、typecheck＋72 測試＋13 路由 build 全綠。
  2. **1 PARTIAL＝訊號→CRM 批准回寫端點未做**：目前訊號 review-only，PRODUCT_SPEC 的「會後訊號經批准回寫 CRM」flywheel 尚缺端點 → **指揮官決定補上**（M5 closeout，小範圍）：POST 批准回寫，寫進 contact 的 objections/pain 等，provenance `filled_by=human, source_type=meeting, verified=1`（CRM_SCHEMA §7 接縫早已定）。
- **carry-forward（非阻斷，記錄）**: 成本記帳未涵蓋 ASR/rolling 分析/speaker 推斷/live-token/grounding（大宗 generation/image/extract 已記，串流小項未記）；persona-lock、真語音體驗待使用者真跑；npm audit（hardening agent 已 triage）。
- **使用者前置（唯一未完＝上線）**: GCP 專案/帳單/網域/DNS、OpenAI 組織驗證、換強 JWT_SECRET，照 `docs/DEPLOY.md` 跑（我不跑 gcloud）。
- **影響**: M5 全量 commit；ARCHITECTURE 里程碑 M5；接著補訊號回寫。**至此 MeetCopilot v2 為 M0–M5 完整成品，只差使用者上線＋真語音驗。**

### 2026-07-08 09:42 | 訊號→CRM 回寫端點補上，M5 PARTIAL 關閉（9/9）
- **誰決定**: Fable（M5 收尾）
- **決策**: 補 `POST /meetings/:id/signals/:signalId/writeback`，讓會後批准的訊號帶 `source_type='meeting'` provenance 回寫 contact/deal（PRODUCT_SPEC flywheel）。ByUser 介面加 optional sourceType/sourceDetail（向後相容）。M5 整合驗收由 8/9 → **9/9**。
- **影響**: 產品 M0–M5 全部功能完成；契約 §5 更新；commit。剩：使用者上線（DEPLOY.md）＋真語音驗＋（carry-forward）串流成本記帳。

### 2026-07-08 06:05 | /code-review 收尾：7 confirmed 全修＋SSRF 回歸攔截
- **誰決定**: Fable（依審查證據＋回歸驗證裁決）
- **決策**:
  1. **多鏡頭對抗式 /code-review**（使用者指定；CodeRabbit CLI 未裝故自建，6 鏡頭 find→對抗 verify-to-refute）：12 raw findings，**5 個假陽性被 refuter 駁回、7 confirmed**（1 critical/5 warning/1 info）全修。
  2. **F1 critical（跨租戶掐會議）務必修**：hub.endMeeting 破壞動作在擁有權檢查前無條件執行——多租戶隔離真漏洞，上線前攔到；加回歸測試。
  3. **F4 SSRF 修法二次校準（關鍵）**：fail-closed `MAP * ~NOTFOUND` 雖最安全但實測**弄壞 www→apex 跨 host 重導**（ghost.org 掛，CyberPower 剛好沒中）→ 改回**只 pin 目標 host**、其餘公網 host 由 per-request 守衛擋私網。CyberPower＋Ghost 重跑皆填出豐富欄位、SSRF 仍擋內網。教訓 L16：安全修正必對既有可用功能＋不同形狀案例回歸。
  4. carry-forward 一併處理：F7 wizard 圖片 413（server 25mb＋前端縮圖）、F2/F3 重連（train live＋/present）、F5 train 錯誤 hang、F6 計時。
- **未修（審查未列為 confirmed，屬既知 carry-forward）**: persona-lock 是否真鎖進 token（需真 /train browser 連線確認，第一次真跑驗）；npm audit 傳遞依賴漏洞（待 M5 triage）；孤兒 ws.ts（可刪，非 bug）。
- **考慮過的替代**: 保留 fail-closed（否——破壞多數真站）；不修 F1 因 meetingId 難猜（否——多租戶破壞動作必須守擁有權，不靠 id 難猜當防線）。
- **影響**: apps/server hub/crawler/train/index＋2 新測試、apps/web liveClient/PresentStage/TrainCall/DeckWizard；LESSONS L16；commit。**M0–M4 全部完成且經對抗審查修正**。下一步＝M5（整合/隱私/成本/上線 GCP）＋使用者真跑驗語音/persona-lock。

### 2026-07-08 03:35 | M2/M3/M4 三線全 PASS＋S3 spike 過＋carry-forward 風險
- **誰決定**: Fable（依三線 fresh-context 驗收裁決）
- **決策**:
  1. **三線驗收全 PASS，入庫**：M2 DynamicSlide（live 測：生成 6 頁 0 空白/pptx 111KB 往返/gpt-image-2 背景圖 1.9MB/refused fallback/I1 攻擊測 409/I3 零-HUD grep 淨/build 綠/CRM 31 測試）、M3 會中副駕（9/9：meeting→wsToken/三角色連線/訊號→hud info_card 且跨 org 不洩/presenter-only 攻擊拒/ACCEPT append I1/present 不收 HUD I3/SessionRuntime 清理/12 路由 build）、M4 語音模擬（真 token mint v1alpha/persona 逐欄過 verified 閘、crawler-only 被拒 400/四維評分/rows 寫入/build 綠/socket 有界/跨 org 隔離）。
  2. **S3 spike PASS（機械面）**：Gemini Live 全鏈路實測（authTokens.create→token 直連→模型音訊+繁中逐字稿）。關鍵事實入 API_FINDINGS：`ai.authTokens`（非 tokens）＋`apiVersion:'v1alpha'`。
- **carry-forward 風險（不擋入庫，交 /code-review 或首次真跑處理）**:
  a. **persona-lock 未驗**（最高價值）：startSession 為安全不回傳 systemInstruction、靠 `liveConnectConstraints` 鎖進 token；若鎖無效 AI 會 persona-less。第一次真 /train 要確認。
  b. **全域 JSON body 2MB**：wizard 帶 logoDataUri+refImageDataUris 可能 413——要嘛升上限、要嘛圖走 multipart。
  c. **theme.bg 可能是 url()/gradient**（生圖背景存這）：pptx-exporter/SlideRenderer 要容忍非純色。
  d. **npm audit 8 個漏洞**（1 critical/1 high，多為 pdf-parse/pptxgenjs 傳遞依賴）——待 triage。
  e. **dist 需重建**：shared/crm 的 `dist/` 早於 M2 decks repo，runtime 靠 dist→部署/dev 要 `npm run build`（gitignored）。
  f. 孤兒 `apps/server/src/ws.ts`（M0 attachWs）已成死碼，整合時刪。
- **語音體驗＝待使用者**：真開口打斷、>15min resumption 需真人+麥克風（同 S1 模式）。
- **影響**: M2/M3/M4 全量程式碼 commit；ARCHITECTURE spike S3/里程碑；接著 /code-review（使用者指定）處理 carry-forward + 找新問題。

### 2026-07-08 01:35 | S4 spike 正式 PASS＋抽取模型分流決策
- **誰決定**: Fable（依 CyberPower 台灣站實測證據裁決）
- **決策**:
  1. **S4 spike 全數關閉（PASS）**：真實爬蟲端到端把**豐富 CRM 欄位**填出來已證實——重驗 `https://www.cyberpower.com/tw/zh`（使用者指定、繁中 B2B）：一筆公司（無重複、domain 回填）、industry/description/legalName（碩天科技股份有限公司＝CyberPower 真實台灣法人）＋5 個產品，`filled_by='crawler'`＋source_url，繁中乾淨無幻覺。加上先前已證的 SSRF 穩、browser.close 有界不懸掛、job 到 done。→ 研究引擎（M1 核心）真正可用。
  2. **抽取模型分流**（決策）：爬蟲結構化抽取用 `GEMINI_EXTRACT_MODEL=gemini-3.5-flash`，一般文字/生成維持 `gemini-3.1-flash-lite`。因 flash-lite 對「爬頁文字→CRM 結構化欄位」不穩（JSON 坍縮/runaway/偷懶，見 L15）——按任務難度配模型，不是一把模型打天下。
- **脈絡與理由**: 使用者要成品，S4 的價值不是「水管通」而是「真的填得出資料」；ghost.org 只填 2 欄暴露 flash-lite 抽取不穩，換 3.5-flash＋CyberPower 實測才真正過關。
- **考慮過的替代**: 全線升 3.5-flash（否——一般文字 flash-lite 夠用又便宜，只有抽取需要）；維持 flash-lite 靠重試（否——它吐的是合法 JSON，重試也救不了）。
- **未消小限（誠實）**: 產品的 description/keyFeatures 常只有 oneLiner（quick 單頁）、近似產品名可能重複（child dedupe 為精確名比對）——detailed 模式爬子頁可補；M1 可接受。
- **影響**: apps/server research/gemini/config、packages/crm upsertFromCrawl、.env(.example) 加 GEMINI_EXTRACT_MODEL、API_FINDINGS §E、ARCHITECTURE_PLAN .env、LESSONS L15。**M1 研究引擎驗收完成 → M2/M3/M4 三線可開工**。

### 2026-07-08 00:20 | .env 祕鑰唯一真相＝apps/server/.env（不再自動同步）
- **誰決定**: 使用者（「以 server 為主」「原本最外層的 .env 我刪掉了」）＋Fable（守則）
- **決策**: `apps/server/.env` 是所有 API key 的唯一落點；根 `.env` 已由使用者刪除。**永久停用**先前「root→server 自動同步」腳本（它造成使用者新填的 OpenAI key 被舊值覆蓋、因 gitignored 無法復原，見 L14）。往後 Claude 對 .env 一律**唯讀、遮蔽檢查**，需要 key 請使用者直接編該檔。
- **脈絡與理由**: server config 讀 apps/server/.env；同步腳本是我救急寫的，反而毀了使用者資料。
- **考慮過的替代**: 讓 server 也載入 root .env（否——使用者選擇單一 server 檔、刪 root，更乾淨）。
- **現況（遮蔽驗證）**: GEMINI_API_KEY（AIza…，107 字元）、OPENAI_API_KEY（sk-proj-…，218 字元）格式皆正確；JWT_SECRET 為 dev 值（M5 上線需換真祕鑰）。
- **影響**: LESSONS L14；S4 實跑爬蟲進行中（用此 .env）。

### 2026-07-07 23:30 | M1 驗收裁決（6/7 PASS，修 crawler 懸掛）＋接縫決策採納
- **誰決定**: Fable（依 B5 fresh-context 驗收證據裁決）
- **決策**:
  1. **M1 驗收通過並入庫**：B5 fresh-context 7 項驗收 6 PASS（typecheck 四 workspace 綠、crm vitest 22/22 含跨 org cosine 隔離/upsert 值+provenance 同 tx/human 覆寫 supersede/confirm/信任守則、29 表遷移、真 server CRM 路由冒煙含細填→provenance supersede、SSRF 兩路擋內網+雲端 metadata、auth shim 已移除、CRM 前端 11 路由 next build 綠）。
  2. **1 項 PARTIAL 修正**：crawler `browser.close()` 在此機懸掛→enrich job 卡 `running`。**派 Opus 修**：close race deadline＋SIGKILL 強殺、整體 crawl deadline、job 失敗一律落 `failed`（見 L13）。此為真 bug（生產也會漏進程/卡 job），非僅環境問題。
  3. **接縫決策採納**（B0/B2/B3/B4 提報）：(a) crm build 拆 `tsconfig.json`(noEmit typecheck)＋`tsconfig.build.json`(tsc -b emit，shared composite)——沿用 apps/server 既證模式，typecheck 零建置順序；(b) 只有 CRM_SCHEMA 有 CHECK 的欄位變 string-literal union，註解型清單保持 string 讓爬蟲不被擋；(c) `crawl_jobs` 經 DbPort 由 research 自管、不進 repo 接縫（M1 可接受，日後要再升 `CrawlJobStore`）；(d) 契約補 deals list `?companyId=` filter（前端 Deals tab 需要，已入契約＋修）；(e) provenance wire 欄位 camelCase（B5 證實 badge 對齊）。
  4. **誠實 gap（需使用者的 key 才能全關）**：Gemini 抽取未驗（B5 環境無 GEMINI_API_KEY）——爬蟲 render＋SSRF 已證，但「爬蟲把 CRM 欄位填出來」要有 key 才能實測。**S4 spike 判定：SSRF 穩、爬蟲 render 可行、抽取待 key**。
- **考慮過的替代**: 把 crawler 懸掛當純環境問題不修（否——生產同樣會漏進程/卡 job，必修）；build 標準化成全 dist（否——維持 M0 的 src-paths typecheck＋dist runtime，成本較低）。
- **影響**: apps/server crawler/jobs/deals（修）、API_CONTRACT deals filter、LESSONS L12/L13、M1 全量程式碼 commit。**使用者行動項**：把 GEMINI_API_KEY 放進 `apps/server/.env`，我再跑一次真爬蟲把 S4 抽取那半關掉。

### 2026-07-07 21:50 | SaaS 成品化（決策 20）＋M0 驗收通過＋契約 v1.1
- **誰決定**: 使用者（成品定調＋四項答覆）＋Fable（部署形態與契約批准）
- **決策**:
  1. **使用者定調：要上線營運的 SaaS 成品，不是 demo**。四答：DB 維持 SQLite 起步／部署 **GCP**／計費先不做（邀請制）／**前端成品全由我方 agent 設計＋實作**（Claude Design prompt 包降為設計規格與使用者參考，不擋工）。
  2. **Fable 部署形態裁決**：SQLite×GCP ⇒ 單一 GCE VM＋持久磁碟＋Docker Compose（server 含 Playwright、web、Caddy TLS）＋每日 snapshot；明令**不部署 Cloud Run**（短暫檔案系統毀 SQLite）；量大遷 Cloud SQL Postgres。
  3. **M0 驗收通過**（A5 fresh-context 6/6 PASS），程式碼入庫。
  4. **契約 v1.1 批准**（M0 揪出的缺口）：/api/health 入約、me 子形狀、ContactSummary 補 id/companyId/fullName、音訊 binary frame＝raw PCM16 LE 16k mono 無標頭（server 到達時間戳）、research_status enum、ping→session_state。另批准：crm 套件不依賴 shared（持久層不該依賴線上契約包，A1 的分層判斷正確）；login 的 direct-SQL shim 限期到 M1（升級 `MembershipRepository.findPrimaryOrgOf`）。
- **考慮過的替代**: 部署選 Vercel+Railway+Neon（Fable 原推薦，使用者選 GCP）；DB 直上 Postgres（Fable 原推薦，使用者選維持 SQLite——已點破 GCP 形態代價並入冊）。
- **影響**: 00-DECISIONS 決策 20、ARCHITECTURE_PLAN（部署 row/M1/M5/前端成品註記）、API_CONTRACT v1.1、.gitignore WAL 側檔、M0 全量程式碼 commit。使用者前置：GCP 專案＋帳單＋網域；後續 M1 開工。

### 2026-07-07 18:10 | S1 結案＋開工分工＋API 契約 v1.0 凍結
- **誰決定**: 使用者（S1 事實＋分工）＋Fable（契約設計）
- **決策**:
  1. **S1 spike PASS 結案**——使用者確認 2026-07-07 那輪 capture-test 就是「真實雙帳號 Meet」情境（Brave/Win11，9 項全 PASS）。會議模型地基成立，可開工。殘項：Window-surface 備援未測（非阻斷）。
  2. **分工**——前端：使用者以 Claude Design 設計互動元件（我方提供設計 prompt 包）；後端：Fable 負責設計（架構/契約/裁決），**程式碼一律派非 Fable 的 agent（Opus）執行**。
  3. **API 契約 v1.0 凍結**（`docs/API_CONTRACT.md`）——關鍵形狀：長任務（爬蟲/生圖）一律 job 模式（202+輪詢+WS 推播）；WS 三角色 capture/hud/present、音訊走 binary frame；presenter-only 動作（suggestion_action/page_commit）server 驗身分；「確認」＝provenance verify、「細填」＝PATCH 實體並寫 human provenance；train 用 ephemeral token 讓瀏覽器直連 Gemini Live（語音不經我方 server）；錯誤一律 `{error}`；前端永不傳 orgId。
- **脈絡與理由**: 使用者要開始設計/實作；平行開發前必須先凍結前後端交界（v1 L5 契約漂移教訓）。
- **考慮過的替代**: 音訊走 JSON base64（否——binary frame 省 33% 頻寬與編解碼）；生圖同步等待（否——gpt-image-2 ~80s 必須 job 化）。
- **影響**: docs/API_CONTRACT.md（新）、docs/FRONTEND_DESIGN_PROMPTS.md（派工中）、M0 實作工作流啟動、ARCHITECTURE_PLAN spike 表 S1 標 PASS、tools/README 矩陣更正。

### 2026-07-07 17:25 | 接收端瀏覽器約束放寬：Chrome/Edge → Chromium 系（Brave 實測通過）
- **誰決定**: Fable（依使用者實測證據）
- **決策**: 「接收聲音端限 Chrome/Edge 桌面」放寬為「**Chromium 系桌面瀏覽器**——Chrome/Edge（文件背書）＋Brave（使用者裝置 2026-07-07 實測 9 項全 PASS，含分頁音訊擷取與錄放回聽）」。同時在 capture-test 工具補 Brave 偵測（UA 偽裝成 Chrome，需 `navigator.brave.isBrave()` 判別）。
- **脈絡與理由**: 使用者用 Brave 跑第一輪 capture-test：環境 4 項＋測試 A（分頁串流、1 條音軌、160KB 錄音可回放）＋測試 B（麥克風）全 PASS；displaySurface=browser、48kHz 立體聲、AudioContext@16k 正常。Brave 是 Chromium 分支，API 面一致。
- **考慮過的替代**: 維持只寫 Chrome/Edge（否——使用者主力瀏覽器就是 Brave，實測已過就該入冊）。
- **留意（未消風險）**: (1) 本輪是單機自測，**還不是真實雙帳號 Meet 情境**（裝置/軟體欄未填）——S1 仍要跑真會議版；(2) Brave 的防指紋（farbling）會對 Web Audio 輸出加極微噪聲，理論上不影響 ASR 品質，S2 實測時順帶確認；(3) Brave Shields 若把會議網站的資源擋掉屬另一類問題，實測時 Shields 保持預設即可。
- **影響**: PRODUCT_SPEC 硬性平台約束、API_FINDINGS §B、tools/capture-test.html、tools/README.md 矩陣首筆。

### 2026-07-07 | 建立 ROM 決策總帳制度（本檔）
- **誰決定**: 使用者（指示）＋Fable（設計細節）
- **決策**: 在 CHANGE_TRACKER 之外新增 ROM——記錄使用者或 Claude 的所有決策；不精簡、可長可雜；每 500 行歸檔到 `rom_archives/ROM_NNN.md`（序號命名）；ROM.md 頂部維護歸檔目錄（每檔一則簡介）。Fable 補的設計：與 00-DECISIONS 分工（蒸餾 vs 全量）、錨點插入機制沿用 CHANGE_TRACKER、查詢順序三段式。
- **脈絡與理由**: 使用者要一個「比 memory 更大更雜」的決策記憶體——memory 必須精簡、CLAUDE.md 有 150 行上限、WORKLOG 記進度不記決策脈絡，三者都裝不下「為什麼這樣決定＋考慮過什麼」的全量資訊。
- **考慮過的替代**: 塞進 memory（否——memory 制度要求精簡）；擴寫 WORKLOG（否——進度與決策混在一起會兩頭難查）；歸檔用日期命名（否——使用者指定序號為主）。
- **影響**: 新增本檔＋`rom_archives/`；CLAUDE.md 硬規則 9＋路由表；HANDOFF 文件索引補列。

### 2026-07-07 | 四項新指示（決策 15–18）與其執行層決策
- **誰決定**: 使用者（四項指示）＋Fable（執行層取捨）
- **決策**: (15) 生圖供應商改 OpenAI「image-2」＝查證後確認 `gpt-image-2`；(16) 做免安裝的音訊擷取相容性測試工具（tools/capture-test.html）供使用者親測各裝置×開會軟體；(17) 移植 ezpagesite 的 code-tracker（實體＝CHANGE_TRACKER 強制變更日誌）；(18) CRM 加「對方產品深檔」（company_products／company_product_people／company_departments）。
- **脈絡與理由**: 使用者看完第一版計畫書後的四項補強——生圖要用他偏好的 OpenAI；硬約束（Chromium-only）要能自己驗證；ezpagesite 的追蹤紀律證明有效想沿用；CRM 要能「完整介紹一家公司的產品含開發人」。
- **Fable 執行層取捨**: 生圖走 `ImageProvider` 抽象（OpenAI 主力、Gemini 降備選、fallback 漸層不變）；預設 `1536x864`（gpt-image-2 原生 16:9，免裁切）＋quality 顯式 medium（auto 會偷跑 high 又貴又慢）；查證出延遲 ~80s 級 → 「一律 pre-meeting」坐實、會中選配唯一候選改 `gpt-image-1-mini`（S5 另議）；CHANGE_TRACKER 移植時加「工作區」欄（monorepo 需要）＋M0 後補 pre-commit hook；CRM 產品↔人用 join 表（不在 contacts 加欄）。
- **考慮過的替代**: 生圖續用 Gemini（否——使用者指定 OpenAI）；測試工具做成 npm 專案（否——要免安裝雙擊可開）；CHANGE_TRACKER 改英文（否——本專案制度檔全繁中）。
- **影響**: API_FINDINGS §F、ARCHITECTURE_PLAN §1/.env/S5/§8、PRODUCT_SPEC、CRM_SCHEMA 產品深檔節、tools/、docs/CHANGE_TRACKER.md、HANDOFF.html。前置行動項：使用者要做 OpenAI 組織驗證＋查 tier 配額。

### 2026-07-07 | 模型分工：Fable 決策、Opus 執行
- **誰決定**: 使用者
- **決策**: 指揮官（主對話）＝Fable，負責拆解、裁決、與使用者對話；搜尋、調查、研究、驗證、審查等 subagent 一律 `model:"opus"`；實作類交辦亦預設 opus。取代先前 haiku/sonnet 便宜優先的預設。
- **脈絡與理由**: 使用者曾在 Fable 暫不可用時切 Opus 續跑（產出第一版計畫書），切回後要求 Fable 審查 Opus 產出——他把 Fable 定位為裁決層、Opus 為執行層。
- **考慮過的替代**: 維持 haiku/sonnet 省成本（否——使用者明示品質優先）。
- **影響**: MODEL_DISPATCH.md 拍板覆寫節、CLAUDE.md 硬規則 1、長期記憶 dispatch-fable-decides-opus-investigates。

### 2026-07-07 | 審查修正批（Fable 三路審查 Opus 產出後採納的修正）
- **誰決定**: Fable（依對抗式審查證據裁決；其中涉產品行為者不改決策只改表述）
- **決策**: 約 25 處修正一次採納，要點——「同瀏覽器硬限制」降級為 UA 行為＋Window-surface 備援（S1 兩條都驗）；生圖「97%」標為非官方（官方＝單行文字錯誤率多 <10%）；Gemini 生圖 API 參數需 `-preview` 後綴；生圖延遲宣稱降為工程估計；`DbPort` 改 async-first（同步簽名會讓換 Postgres 的承諾破功）；CRM 實作順序補漏掉的賣方側三表；TASK_TEMPLATES 移除已廢除的 INSERT_AFTER 教學；M0 驗收與 spike gate 解耦（S1 需使用者協助不得擋 M0 收尾）；M0 補 .env 全欄位/vitest/npm scripts；Playwright 端 SSRF 改 page.route 攔截方案（DNS-pin 不適用）；persona 欄位逐欄過 provenance 閘（不看 rollup）；(org_id,domain) 改 UNIQUE；補 schema_migrations 最小 DDL 等。
- **脈絡與理由**: 使用者要求「檢查 Opus 產出是否足夠詳細與正確」；三路審查（事實再查核／跨檔一致性／CRM schema）＋Fable 親自比對抓出。
- **考慮過的替代**: 無（各項皆有證據）。
- **影響**: 幾乎全部 docs；commit 15bec1b。

### 2026-07-06 | v2 大 pivot 全套決策（14 項＋會議模型）
- **誰決定**: 使用者（三輪 AskUserQuestion＋兩則補充訊息拍板）
- **決策**: 從零重寫為「CRM 核心＋三消費端」平台；同棧（Next.js+Express+ws+SQLite+Gemini）；傘名沿用 MeetCopilot；M2 起三線並行；語音模擬與第一產品並行；先本機留雲端路；SQLite＋repository 層；混合式研究引擎（grounding＋搬 ezpagesite 爬蟲＋SSRF 補洞）；研究自動＋手動觸發；生圖兩模式都做；語音模擬用 Gemini Live 直接做語音版；新頁一律 append 尾端**仍需批准**（I2 保留）；HUD 用第二裝置；分軌改「轉逐字後 LLM 推斷」；**會議模型＝純網頁雙帳號**（A 分享簡報分頁、B 靜音進會擷取混音，不做桌面版，Electron 全案作廢）。完整清單見 00-DECISIONS（該檔為蒸餾版真相來源）。
- **脈絡與理由**: v1 單一「會中簡報 Copilot」範圍太小；使用者要兩個 B2B 開會產品共用 CRM 地基，爬蟲先填、用戶細填。
- **考慮過的替代**: 在 v1 monorepo 重構（否——使用者選從零重寫）；只用 Gemini grounding 或自建全套 crawler（否——選混合）；文字版模擬先行（否——直接語音）；桌面版（否——雙帳號讓 web-only 成立）。
- **影響**: 建 MeetCopilot_v2 repo＋整套計畫書；v1 保留為參考件不動。

### 2026-07-04 ～ 07-05 | v1 時期關鍵決策（摘要，詳見 v1 repo 的 WORKLOG/LESSONS）
- **誰決定**: 使用者＋當時指揮官
- **決策**: 純瀏覽器 Web＋Electron 殼雙軌（後被 v2 雙帳號模型作廢）；LLM 全 Gemini；SQLite＋JS cosine；自建 JWT；文字模型統一 `gemini-3.1-flash-lite`；簡報走結構化 SlideSpec＋CSS 模板（非整頁生圖）；批准閘 I2／pending-only I1／HUD 隔離 I3 三不變量；制度檔體系（指揮官不下場、隨做隨存、驗證不自驗…）。
- **脈絡與理由**: v1 從規格到可跑 MVP 的全程決策；多數制度與教訓（L1–L11）被 v2 繼承。
- **影響**: v1 repo（c:/Users/Martin/Desktop/MeetCopilot）；v2 的 PORTED 零件清單與制度檔。

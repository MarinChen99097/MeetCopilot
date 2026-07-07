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

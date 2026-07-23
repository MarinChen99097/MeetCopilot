# CHANGE_TRACKER — 程式碼變更追蹤（強制）

> 制度源自 ezpagesite `CLAUDE.md` 的「Change Tracking — MANDATORY」（使用者 2026-07-07 指示移植，決策 17），v2 加上「工作區」欄位。
> **每個 session 都必須遵守，無例外。**

## 規則

1. **每次修改程式檔後**（Edit/Write 任何 `.ts`／`.tsx`／`.js`／`.mjs`／`.cjs`／`.css`／`.json`（含 package.json、tsconfig）等程式相關檔案），**必須立刻**在本檔追加一筆紀錄。
2. **不可延後、不可批次補寫**——改完一個檔案（或一組相關檔案）就寫一筆。
3. 每筆必含（模板見下）：`### YYYY-MM-DD HH:MM | 主題`（24 小時制、必含日期）＋**工作區**＋**類型**＋**檔案**＋**改了什麼**（關鍵邏輯附 Before/After）＋**為什麼**（根因或需求背景）。
4. **嚴禁用 Write 覆寫本檔**。安全寫入法：
   - 先 `Read(offset=1, limit=10)` 確認錨點存在；
   - 再用 Edit，`old_string` 用 `---` 加空行加 `<!-- TRACKER_BELOW -->`（**必須含 `---` 前綴**，否則會撞到本檔規則裡的範例文字），`new_string` ＝原字串＋新紀錄。
5. **超過 500 行自動打包**：把 `<!-- TRACKER_BELOW -->` 以下全部搬到 `docs/change_archives/archive_YYYY-MM-DD.md`，本檔清空只留標頭＋錨點，再插入新紀錄；並在下方 Archives 清單補連結。
6. **不需追蹤**：唯讀操作（Read/Grep/Glob）；修改本檔自身；`docs/*.md` 制度與計畫文件（由 WORKLOG 涵蓋）；臨時除錯檔。
7. **M0 建好 package.json 後**：加輕量 pre-commit hook——staged 有程式檔而本檔無同批新增紀錄 → 擋 commit（把 ezpagesite 純靠紀律的缺口關上）。

## 紀錄模板（照抄替換）

```
### YYYY-MM-DD HH:MM | 主題名稱
- **工作區**: packages/shared｜packages/crm｜apps/server｜apps/web｜tools
- **類型**: feat｜fix｜refactor｜chore
- **檔案**: `path/to/file.ts`, `path/to/other.ts`
- **改了什麼**: 具體改動；關鍵邏輯附 Before/After
- **為什麼**: 根因或需求背景
```

## Archives

- [`change_archives/archive_2026-07-19.md`](change_archives/archive_2026-07-19.md) — 涵蓋 2026-07-07 ~ 2026-07-18（55 筆、602 行）。主題：M0 地基→M5 完成→GCP Cloud Run 部署上線；CRM 核心＋研究引擎擴編（爬蟲深廣多輪、社群來源、雙語 *Zh gloss、per-contact 背景抽取 MAX_TOKENS 韌性、deep/more 模式）；DynamicSlide／會中副駕／模擬訓練三產品線；admin 平台後台＋記帳＋停權；UI 換皮＋可收折側欄 Shell＋首頁儀表板；Postgres 移植；多輪 code-review／simplify 修復。2026-07-19（含）起之新紀錄留於本檔。

---

<!-- TRACKER_BELOW -->

### 2026-07-23 16:20 | CRM Phase A Cycle 1：手動解鎖對練（training_unlocked）＋新增主管補欄＋子表重爬不覆寫人工值
- **工作區**: packages/shared, packages/crm, apps/server, apps/web
- **類型**: feat
- **檔案**: `packages/shared/src/crm-types.ts`、`packages/crm/migrations/020_training_unlock.sql`(新)＋`migrations-pg/020_training_unlock.sql`(新)、`packages/crm/src/mappers.ts`、`repos-prospect.ts`、`child-upsert.ts`、`crm.test.ts`(A5a 測)、`apps/server/src/train/{persona.ts,train-service.ts,train-gate.test.ts(新)}`、`apps/web/components/crm/{useProvenance.ts,PersonaCard.tsx,ContactsTab.tsx}`、`apps/web/lib/api.ts`
- **改了什麼**:
  - **A1 手動解鎖對練（R4c：手動點、不用內容判定）**: Contact/ContactSummary 加 `trainingUnlocked?: Bool01`；migration 020 `contacts.training_unlocked INTEGER NOT NULL DEFAULT 0`（sqlite 一欄一 ALTER／pg `ADD COLUMN IF NOT EXISTS`）；CONTACT_DEFS 加 def、list SELECT＋mapContactSummary 帶出；train-service 兩處閘改「`!passesGate(readiness) && !trainingUnlocked`」（逐欄信任閘 **OR** 手動解鎖）；PersonaCard 高信任區塊加「🔒/🔓 解鎖對練」按鈕 → `save("trainingUnlocked", 0/1)`。**刻意不走 field_provenance 信任層**（避免把「可對練」與「欄位可信」綁定，見 CRM_SCHEMA §11 反模式）。
  - **A2 新增主管補欄**: `createContact` 前端型別放寬（+department/seniority/decisionPower，server `sanitize<NewContact>` 早已接受）；AddContactForm 加 部門/職級/決策權（＋SENIORITY_SHORT）。
  - **A5a 子表重爬不覆寫人工值（M1 §3 延伸）**: `ChildUpsertSpec` 加 `entityType?`；`upsertChild` matched 分支若有 entityType 則 `trustedFieldsOf(db,orgId,entityType,matched.id)` 取信任欄、於 accumulate 前 `delete rec[def.col]`；PRODUCT_SPEC 設 `entityType:"company_product"`（對齊產品 PATCH provenance:545）、CONTACT_SPEC 設 `entityType:"contact"`（對齊:389）。news/tech 等 crawler-owned 子表未設 → 行為不變。
  - **web save 放寬**: `useProvenance.save`／PersonaCard `save` prop 值 `string→unknown`（供旗標數值＋日後陣列編輯 A3）。
- **為什麼**: 使用者回報模擬訓練「無法手動新增主管、驗證應手動、很難測試」，且「重爬會蓋掉修正」。Cycle 1 解鎖測試＋保護人工值。不動 I1/I2/I3（未碰 deck/approval/HUD）。
- **測試**: `crm.test.ts` A5a（產品 human 值重爬不覆寫＋未鎖欄正常更新，2 測）＋`train-gate.test.ts`（0 verified 欄手動解鎖後可對練、鎖回不可，1 測）。
- **/simplify（4 項）**: `persona.ts` 抽 `canTrain(readiness, unlocked)` 單一擁有者（train-service 兩處閘改用）；`mapContactSummary` Bool01 映射對齊慣例 `(… as 0|1|null) ?? undefined`；`child-upsert` 移除冗餘 `if(trusted.size>0)` 守衛；`SENIORITY_LABEL` 去重（PersonaCard export、ContactsTab 重用，刪 ContactsTab 重複常數）。
- **驗證**: 兩輪對抗式 Workflow（第 2 輪＝/code-review 6 視角）——build shared→crm→server→web、**crm 67＋server 270 測全綠**、web build 18 路由；bug/正確性・I1/I2/I3/SSRF・authz・錯誤邊界 **5 視角無 ≥80**；脈絡一致性抓 1 筆（信心 88＝Cycle 1/R4c 決策未記 ROM）**已補**（ROM 2026-07-23 CRM 升級條目）。未 commit（硬規則 10）。
- **工作區**: apps/server, apps/web
- **類型**: fix
- **檔案**: `apps/server/src/realtime/orchestrator.ts`、`apps/server/src/generation/slide-gen.ts`、`apps/web/app/studio-present.css`
- **改了什麼**:
  - **生成頁仍深色不匹配（根因）**: 前輪做了匯入端逐頁抽色（`slide.theme`）＋`SlideRenderer` 衍生，但 `orchestrator.maybeSuggestSlide` 呼叫 `generateSupplementSlide` 時**從未傳 `anchorSlide`** → `sanitizeSlide(raw, undefined)` → 補充頁 `theme=undefined` → 前端退 app 深色。（線上實查：最新 deck 19 頁匯入頁**皆有淺色 theme**，`#f6f7f9`／末頁真實主色 `#911d22`/`#1595f7`——producer 正常、consumer 斷線。）修：新增私有 `deckTailSlide(orgId, deckId?)`＝`core.decks.findWithSlides` 取 `slides.at(-1)?.spec`（deckId 缺/撈失敗/無 slide → undefined，try/catch 吞錯不阻斷）；`maybeSuggestSlide` 撈 deck 尾頁當 anchor 傳入 → 補充頁繼承匯入 deck 配色（含級聯：後續補充頁 anchor＝前一張已themed 補充頁）。
  - **版型太單一**: `generateSupplementSlide` system prompt 加「補充頁專屬規則」——依當下訊號性質挑版型（數據→stats/chart、我方vs競品/對比→content＋two-col、清單→bullets、單點/報價/下一步→section 或 paragraph，僅並列 3-4 獨立重點才 features），明文覆寫 `TEMPLATE_INTENT_ZH` 的「content 優先 features」。
  - **下緣被裁**: 同 prompt 加「版面預算」——用 features 時不放 subheading（大標直接帶重點）、features≤3、每張 desc 一句話（~20 全形字）、不放 eyebrow、一頁一重點。`studio-present.css` `.feature__desc` 加 `-webkit-line-clamp:2`＋`box-orient`＋`overflow:hidden` 安全網（過長 desc 省略號收尾、不硬裁整卡；正常一句話 desc 與 studio deck 無感）。
- **為什麼**: 使用者 `/sim` 二輪實測回報：生成頁仍深色不匹配、下緣被切、版型太單一。2 opus agent 平行診斷（含撈線上 deck 實際 theme 值）定位 anchor 未接為深色根因。不動 I1/I2/I3（只補 anchor 唯讀讀取＋prompt/CSS）。
- **驗證**: fresh-context agent——server typecheck PASS、server `vitest` **47 檔 269 測全綠**（`supplement-slide` 7 測如預期過：測試 runtime 無 deckId → `deckTailSlide` 早退不碰 core；orchestrator/I2 authz 相關測皆綠）、web typecheck＋`next build` 18 路由 PASS。未 commit（硬規則 10）。

### 2026-07-20 19:40 | code-review 修正：pptx 匯出圖表色對齊螢幕衍生（維持 WYSIWYG 不變量）
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/generation/pptx-render.ts`
- **改了什麼**: 19:15 讓 `SlideRenderer` 螢幕端在有顯式主色時衍生 `--slide-accent-2/-3`，但 pptx 匯出 `chartPalette` 仍固定用 `CHART_ACCENT_HUES`（7c6cff/ff5d9e）→ themed deck 多序列圖表「螢幕預覽 ≠ 匯出 .pptx」（違反 `slide-spec.ts:59-61`／`studio-present.css:13-15` 宣稱的 WYSIWYG）。修：`ResolvedTheme` 加 `accentIsExplicit`（`normalizeHex(theme?.accent,"")!==""`）；加 `mixWithBlack(hex,ratio)=各通道×ratio`；`chartPalette(accent, accentIsExplicit)`——顯式主色時 series 2/3＝`mixWithWhite(accent,0.58)`／`mixWithBlack(accent,0.66)`（＝螢幕 `color-mix(accent 58% white)`／`(accent 66% black)`），series 4-6 沿用前三色 55/55/60% 混白，與 `slide-chart.tsx` PALETTE **逐格對齊**；無顯式主色仍用固定 hues（＝CSS 預設）。呼叫點傳 `theme.accentIsExplicit`。
- **為什麼**: `/code-review`（脈絡一致性視角，信心 88）抓到的唯一 ≥80 Warning；使用者 AskUserQuestion 選「修 pptx 匯出對齊」。
- **驗證**: fresh-context agent——server typecheck PASS、server `vitest` **47 檔 269 測全綠**（`pptx-merge`/`pdf-merge`/`palette` 皆過；無測試斷言圖表色故未破）、web typecheck PASS。未 commit。

### 2026-07-20 19:15 | 匯入頁抽色 → 生成補充頁風格對齊（消除「深色紫模板 vs 淺色匯入 deck」落差）
- **工作區**: apps/server, apps/web
- **類型**: feat
- **檔案**: `apps/server/package.json`(+`pngjs`/`@types/pngjs`)、`apps/server/src/import/palette.ts`(新)、`import/palette.test.ts`(新)、`import/conversion-job.ts`、`apps/web/components/slide/SlideRenderer.tsx`
- **改了什麼**:
  - **根因**: 匯入 PDF 無結構化配色 → `conversion-job` 的 image-full spec 不帶 theme → 生成補充頁（讀 `anchorSlide.theme`）繼承到空 → 退回 app 深色紫預設模板，與淺色匯入 deck 落差大。使用者拍板策略「**抽色為主、抽不到退中性淺色**」。
  - **抽色（`palette.ts`）**: 用 pngjs 解每頁 PNG——四角＋四邊中點取樣平均為 bg（彼此分歧 >96 視為低信心）、依 bg 亮度給深/淺 text、稀疏掃描取「最飽和且亮度適中、離背景夠遠」的像素為 accent（飽和 <0.28 退中性）；任一步失敗/低信心回 `NEUTRAL_LIGHT_THEME`（`#f6f7f9`/`#1b2130`/`#4f6bed`）。
  - **接線（`conversion-job.ts`）**: 每頁 `extractPaletteFromPng(png)` → 帶入 `buildImageFullSpec(assetId, source, theme)`（spec 多 `theme` 欄）。pdf/pptx 皆套；不覆蓋 deck 層 theme。
  - **消招牌色（`SlideRenderer.themeStyle`）**: `theme.accent` 存在時，額外把 mesh/圖表用的 `--slide-accent-2/-3` 以 `color-mix` 從主色衍生（淺調/深調同色系），取代 CSS 預設 `#7c6cff`/`#ff5d9e` 紫粉 → 生成頁 mesh/漸層/圖表改採 deck 色調。**副作用**：studio AI 生成 deck 的多序列圖表色亦轉為單一色系（同色明暗區分，可接受、更貼品牌）。
- **為什麼**: 使用者回報「生成簡報排版有問題、且與前面匯入的簡報風格差異太大」；PDF 無 theme 是根因。不動 I1/I2/I3（僅視覺 theme／匯入 spec 帶主題）。
- **驗證**: fresh-context agent——server typecheck PASS、server `vitest` **47 檔 269 測全綠**（含新 `palette.test.ts` 5 測、`conversion-job.test` 5 測不破）、web typecheck PASS、`next build` 18 路由 PASS。未 commit（硬規則 10）。

### 2026-07-20 18:30 | 會中副駕 HUD markdown 渲染＋欄寬修復；DynamicSlide 補充頁佈局重疊修復＋生成收斂
- **工作區**: apps/web, apps/server
- **類型**: fix
- **檔案**: `apps/web/components/ui/Markdown.tsx`(新)、`components/hud/InfoCardStream.tsx`、`components/crm/NotesTab.tsx`、`app/globals.css`、`components/sim/MeetingSimulator.tsx`、`app/studio-present.css`、`apps/server/src/generation/slide-gen.ts`
- **改了什麼**:
  - **markdown 未渲染（情報卡/深查卡）**: `InfoCardStream.tsx:38` 原 `<p>{c.body}</p>` 純字串直出 → 字面顯示 `**粗體**`/反引號/清單。抽共用 `<Markdown>`（react-markdown＋連結 scheme 白名單＋a-tag noopener＋`div.mc-md`，移自 NotesTab）套上；NotesTab 一併收斂到共用元件（移除本地 `mdUrlTransform`/`MC_MD_COMPONENTS`/`ReactMarkdown` import）。數學 `$...$` 仍不渲染（未裝 katex，另議）。
  - **HUD 欄寬擠成細長條**: `globals.css:1233` `.mc-hud` grid `1fr 1fr`→`minmax(0,1fr) minmax(0,1fr)`（`1fr`=minmax(auto,1fr) 令 CJK 被壓到 min-content）；`/sim` 的 HUD wrapper（`MeetingSimulator.tsx`）className 加 `mc-cockpit__hud` → 套既有「內嵌單欄」規則（`globals.css:1448`），窄面板改單欄可讀。
  - **補充頁文字重疊**: `studio-present.css:134` `.slide-block--features` `flex:1` 漏 `min-height:0`＋`align-content:center` → 被上方 chart/stat 擠扁時上下雙向溢出、標籤疊到 feature 標題。修＝加 `min-height:0`＋`align-content:safe center`（超出退 start 往下裁切、不往上溢）；`.slide-block--two-col` 同補 `min-height:0`。
  - **生成端收斂**: `slide-gen.ts` prompt（`TEMPLATE_INTENT_ZH`/`DESIGN_PRINCIPLES_ZH`）禁止「chart 或多個 stat」與 features 同頁（硬塞重疊的源頭）。
- **為什麼**: 使用者實機跑 /sim 後回報 HUD 排版差、markdown 沒渲染、補充頁重疊。皆 UI/prompt 層修復，不動 I1/I2/I3。
- **驗證**: fresh-context agent：web typecheck＋server typecheck＋`next build`(18 路由)＋server `vitest` 264 測全綠；NotesTab 無殘留引用。未 commit（硬規則 10）。

### 2026-07-20 16:10 | 底層 AI 記帳全面對齊 ezpage：五桶 token＋差別計價＋每列稅率快照＋運行時安全網（migration 019）
- **工作區**: packages/shared, packages/crm, apps/server, apps/web, docs
- **類型**: feat
- **檔案（資料層）**: `packages/crm/migrations/019_usage_detail.sql`(新)＋`migrations-pg/019_usage_detail.sql`(新)、`packages/shared/src/ops-types.ts`(UsageEvent/NewUsageEvent 加新欄)、`packages/crm/src/repos-ops.ts`(record INSERT 加欄)。
- **檔案（記帳管線）**: `apps/server/src/gemini.ts`(TokenUsage/UsageMetadataLoose/readUsage 取 thoughts/cached＋raw 三方法掛安全網)、`ops/pricing.ts`(ModelPrice/PRICING/FALLBACK 加 reasoning/cached 單價＋estimateCostUsd 差別計價＋DEFAULT_TAX_MULTIPLIER/taxMultiplierFor＋PricingRow/loadPricingOverrides 擴充)、`ops/meter.ts`(MeterResult 加新欄)、`ops/meter-impl.ts`(稅前差別計價＋每列稅率快照＋抑制安全網)、`ops/metered-gemini.ts`(plumb reasoning/cached)。
- **檔案（安全網）**: `apps/server/src/ops/metering-context.ts`(新，ALS)＋`ops/metering-middleware.ts`(新)、`index.ts`(4 個 AI-using 掛 meterBoundary)、`realtime/hub.ts`(runMeteredForMeeting 包 onAsrFinal/onSignals)。
- **檔案（呈現）**: `org-routes/usage-queries.ts`(orgUsage/Events 回 posttax＋新 token/tax 欄)、`apps/web/lib/api.ts`(型別)、`components/spend/SpendDashboard.tsx`(改讀後端 posttax＋明細加 reasoning/cached/retry 欄)。
- **測試/契約**: `ops/metering-safety-net.test.ts`(新 6)、`ops/pricing.test.ts`(+3 差別計價/稅率)、`org-routes/usage-authz.test.ts`(+posttax/稅率斷言)、`docs/ADMIN_CONTRACT.md` v1.3。
- **改了什麼**:
  - **緣起**: 使用者問「底層 AI 呼叫邏輯有沒有參考 ezpage」——答：前端有、底層沒有（用 MeetCopilot 既有 Meter 接縫）。調查 ezpage `marketing_backend` 後拍板**全面對齊**＋稅率 ×1.25 套**全部** AI（ezpage 只套生圖）＋防漏安全網走**運行時補記**。
  - **五桶 token＋差別計價**: gemini usageMetadata 取 `thoughtsTokenCount`→reasoning、`cachedContentTokenCount`→cached；`estimateCostUsd` 改：uncachedInput=(input−cached) 走 input 價、cached 走較便宜 cachedInputPerM（避免雙算）、reasoning 走 reasoningPerM(≈output)。既有無 reasoning/cached 的呼叫成本不變（向後相容，253 測不動）。
  - **每列稅率快照**: `est_cost_usd` 續為**稅前**；新 `cost_tax_multiplier`（DEFAULT 1.25）每列快照；含稅＝稅前×該列稅率（查詢/顯示層算，改預設不回溯既有列）。admin §4 端點形狀不變（續呈稅前）。
  - **運行時安全網（對齊 ezpage SDK-boundary autolog）**: ALS 計費脈絡（`runWithMetering`，於 realtime hub 每場＋AI-using request 邊界設 orgId/kind/meetingId/userId/meter）；raw GeminiClient 的 `generateJson`/`generateGrounded`/`embed`（**非** Metered 變體）呼叫後 `safetyNetRecord`——脈絡存在且未抑制時補記一筆。`meter.meter` 以 `withSuppressedMetering` 抑制其 fn 期間的安全網（防與 explicit metering 雙記）。metered wrapper 走 Metered 變體（不掛安全網）→ 天然不雙記。
  - **org 花費呈現**: `/api/org/usage(+events)` 回稅前＋含稅（SUM(est_cost × cost_tax_multiplier)）＋reasoning/cached/retry；SpendDashboard 改讀後端 posttax（每列稅率）＋明細顯示新欄。
- **為什麼**: 使用者要底層記帳對齊 ezpage 的成熟度（token 細分準確、每列稅率、raw 呼叫不漏記）。純記帳可觀測性強化＋唯讀呈現；**不動 I1/I2/I3**（未碰 deck patch/approval/HUD）；記帳仍為吞錯副作用、不改業務結果。
- **驗證**: 全 workspace tsc 綠（shared/crm/server/web）；重建 shared+crm dist；server `vitest run` **46 檔 262 測全綠**（含新 safety-net 6／pricing +3／usage-authz posttax）；crm 65 測（migration 019 從空庫套用＋既有列 DEFAULT 回填）；web `next build` 18 路由綠。未 commit（硬規則 10）。
- **審後修正（fresh-context 對抗驗證：8 項 7 PASS＋1 真 bug，已修）**: **安全網併發雙記**——`withSuppressedMetering` 用單一布林「存/還原 prev」，僅 LIFO 巢狀正確；deep research 的 grounding 並行池（同脈絡內併發多個 explicit meter，預設併發 2）下，先完成者的 finally 把旗標還原成 false → 讓並行中的裸 grounded 安全網誤放行 → 雙記（org 儀表板系統性高估）。修＝`suppressed` 改**深度計數器**（`{depth}`，任一 explicit meter 在飛即抑制，併發安全）——`metering-context.ts` 三處（interface/withSuppressedMetering ++/--/safetyNetRecord depth>0）＋補併發回歸測試。複驗 server tsc 綠＋safety-net 7 測＋全套 263 測全綠。
- **/code-review（5 視角 opus→對抗評分→濾≥80）：raw 6→confirmed 0，順修 2 門檻下（皆為本輪新建機制的正確性、修法便宜）**:
  1. **安全網自我干擾（scores 24/30/50，dormant）**：`safetyNetRecord` 自己的補記也走 `ctx.meter.meter`，而 meter-impl 對每個 fn 一律 `withSuppressedMetering`（depth++）→ 併發的兄弟安全網補記會被自己短暫抬高的 depth 誤抑制而漏記（目前熱路徑無 raw 呼叫故 dormant，但這正是安全網的目的）。修＝安全網補記以 **`als.exit()` 走出 ALS 脈絡**再記，其 meter.meter 的 withSuppressedMetering 見不到 store → 不動 depth；explicit metering 仍在脈絡內照常抑制。補**真 meter-impl 路徑**回歸測試（fakeMeter 測不到 withSuppressedMetering，改用 createMeter+假 repo 驗兩筆併發安全網都落）。
  2. **org usage day 分組記憶體（score 55）**：`orgUsage` day 分支逐列拉回、from/to 使用者可控 → 加 `USAGE_MAX_WINDOW_MS`(400 天) 守衛（/usage＋/usage/events，超窗 400）。
  複驗 server tsc 綠＋全套 **264 測全綠**（safety-net 8）。
- **工作區**: apps/server, apps/web
- **類型**: feat
- **檔案（server）**: `apps/server/src/realtime/orchestrator.ts`（geminiFor/groundedMetered 助手＋A/B/C 三處接 metered）、`apps/server/src/train/scoring.ts`（score 加 per-call client override）＋`train-service.ts`（deps 加 gemini、finish 現包 metered client＋userId）＋`train/routes.ts`（傳 gemini＋finish 帶 userId）＝洞 D、`apps/server/src/org-routes/usage-queries.ts`(新)、`apps/server/src/org-routes/index.ts`（+2 路由）、`apps/server/src/org-routes/usage-authz.test.ts`(新)。
- **檔案（web）**: `apps/web/lib/format.ts`(fmtUsd/fmtCompact)、`apps/web/lib/api.ts`(getOrgUsage/getOrgUsageEvents+型別)、`apps/web/components/spend/SpendDashboard.tsx`(新)、`apps/web/app/[locale]/spend/page.tsx`(新)、`apps/web/components/AppShell.tsx`(nav.admin 加 spend＋coins icon)、`apps/web/messages/{zh-TW,en}.json`(nav.spend)。
- **改了什麼**:
  - **緣起**: 使用者要「每次調用 AI 都記錄成本」＋ apps/web 開一個 AI 花費 dashboard（參考 ezpage、稅 ×1.25）。稽核出計費雖大致完整但有 **4 個 AI 呼叫漏記帳**（全走 raw gemini client、不經 Meter）：**A** 補充頁生成（本 session 新加）、**B** 說話者推斷 inferSpeaker（每 ASR 段、量最大）、**C** 會中即時深查 grounded、**D** 訓練評分。
  - **補記帳（洞 A/B/C，orchestrator）**: 新私有助手 `geminiFor(sessionId,kind,tag)` 依既有 metered 樣板（retrieval/analysis）現包 `meteredGeminiClient`（orgId＋meetingId＋presenter userId，idemPrefix 帶 uuid），無 meter/runtime 退 raw。A＝maybeSuggestSlide 生成走 gm；B＝inferSpeaker 走 gm；C＝`groundedMetered` 手動 `meter.meter`（metered wrapper 對 grounded 透傳不記，故手動；token 以字元/4 估）＝記 gemini_text。
  - **補記帳（洞 D，train）**: TrainScorer.score 加可選 `client` override；train-service deps 加 raw `gemini`，finish 現包 metered client（gemini_text＋userId）傳給 scorer；finish 簽名加可選 userId，routes 傳 `req.auth.userId`。behaviour 不變（記帳純副作用）。
  - **org-scoped 花費端點**: 使用者拍板本 org 自己的花費、owner/admin 可見。新 `usage-queries.ts`（`orgUsage`/`orgUsageEvents`，一律 `WHERE org_id=?`、佔位符 `?`、day 走 JS UTC 分桶——與 admin-queries 同構但 org-filtered）＋org-router 加 `GET /api/org/usage?from&to&groupBy=kind|model|day` 與 `/usage/events?...`（皆 `mw(requireManager)` owner/admin 閘）。**不動既有 admin `/api/admin/usage`（platformAdmin）與 by-kind `/api/usage`**。
  - **前端 dashboard（/spend）**: 導覽 nav.admin 群組（owner/admin 才顯示，沿用 adminOnly）；KPI（含稅總花費/總 tokens/呼叫數）＋日期範圍（近 7/30/90＋date input）＋groupBy 切換（項目/模型/日期）表格（**稅前 → 含稅 ×1.25 雙欄**＋CSS 佔比條）＋逐筆明細抽屜（分頁）。`TAX_MULTIPLIER=1.25` 集中一處、免責文字說明估算值＋含稅=稅前×1.25。純自繪表格/CSS 條、無圖表庫（沿用專案慣例）。
- **為什麼**: 兌現「AI 呼叫成本可觀測且完整」＋讓使用者在既有前端看本 org 花費。純新增記帳（吞錯副作用、不改業務行為）＋唯讀 org-scoped 查詢；**不動 I1/I2/I3**（未碰 deck patch/approval/HUD 路徑），新端點過 owner/admin 閘且租戶硬隔離（A1 風格）。
- **驗證**: server `tsc` 綠、`vitest run` **45 檔 253 測全綠**（新 usage-authz.test.ts 5 測：401／member 403／owner 200＋租戶隔離他 org $9.99 不混入／明細 org-scoped／groupBy=model＋非法 400）；web `tsc` 綠、`next build` 18 路由綠（新增 /spend 3.91kB）；messages JSON parse OK＋nav.spend parity。未 commit（硬規則 10）。
- **審後修正（fresh-context 對抗驗證：8 項全 PASS，1 LOW＋1 一致性順修）**: (1) **洞 C model 標籤不符**——`groundedMetered` 記 `model:inferenceModel`(flash) 但實際 `generateGrounded({prompt})` 未帶 model→用預設 textModel(flash-lite)，dashboard 研究列 model 誤標＋以 flash 費率略高估。修＝`generateGrounded({prompt, model:this.deps.inferenceModel})` 兩處，讓呼叫與記帳一致（且對齊 grounding 升模 flash 慣例——gemini.ts:136 註解＋90s timeout 本就假設 flash）。(2) `/api/org/usage/events` 補 `from>to→400`（與 /usage 一致；原回空結果非崩潰非洩漏）。複驗 server tsc 綠＋12 測（usage-authz 5＋supplement 7）綠。

### 2026-07-20 14:00 | DynamicSlide 對話→補充頁生成橋接（接上生產缺失的一段）＋會議模擬器測試工具
- **工作區**: apps/server, apps/web
- **類型**: feat
- **檔案（server）**: `apps/server/src/config.ts`, `apps/server/src/generation/slide-gen.ts`, `apps/server/src/realtime/orchestrator.ts`, `apps/server/src/realtime/hub.ts`, `apps/server/src/realtime/supplement-slide.test.ts`(新), 及 5 個 test config 字面＋mid-meeting-crm.test.ts orchestrator deps 補新必填欄。
- **檔案（web）**: `apps/web/lib/mp3-capture.ts`(新), `apps/web/components/sim/MeetingSimulator.tsx`(新), `apps/web/app/[locale]/sim/page.tsx`(新), `apps/web/components/AppShell.tsx`, `apps/web/messages/{zh-TW,en}.json`。
- **改了什麼**:
  - **根因**: 全 repo `patch.suggest()`（產生待批准補充頁的唯一入口）**無任何生產呼叫者**，只有測試；`orchestrator.onSignals` 只做 CRM 檢索→info_card＋自動深查。→ DynamicSlide 的 append 機制（I1/I2/patch-service/deck_update/present 渲染）全建好但「會中依對話生成一張補充頁並送批准」這條觸發線從未接上＝真會議永不 append。
  - **config**: 加 `supplementAutoLimitPerMeeting`（env `SUPPLEMENT_AUTO_LIMIT_PER_MEETING`，預設 8；0＝關閉）。
  - **slide-gen**: `export const SLIDE_SCHEMA`（原 private）＋新 `generateSupplementSlide(gemini,model,language,{transcriptContext,signalSummary,companyName?,anchorSlide?})`——與 deck 生成共用 prompt 片段＋`sanitizeSlide`（禁 image、空頁回 null）；單頁、maxOutputTokens 2048、attempts 2。
  - **orchestrator**: 加 `onSuggestSlide(cb)` sink＋`maybeSuggestSlide()`（在 `onSignals` 第 3 步 fire-and-forget 呼叫）。合格訊號 `SUPPLEMENT_TRIGGER_KINDS`（interest/objection/pain/competitor_mention/buying_signal/risk/pricing/next_step/topic_shift；排除 person_mention/landmine）＋節流（`supplementThrottleMs`，預設 env `SUPPLEMENT_THROTTLE_MS`/40s，樂觀佔窗防並發）＋每場配額（`supplementAutoLimitPerMeeting`，成功才計）。`companyName()` best-effort 讀 `core.companies.findById` grounding。`disposeSession` 清 `lastSuggestAt`/`suggestCount`。`OrchestratorDeps` 加 `supplementAutoLimitPerMeeting`＋可選 `supplementThrottleMs`（僅測試覆寫）。
  - **hub**: 傳 `supplementAutoLimitPerMeeting`；`onSuggestSlide((sid,slide,reason)=>this.patch.suggest(...))`——I2 不變（只入列 HUD 批准佇列，報告者手動 ACCEPT 才 append；patch.act 的 presenterAuth 閘照舊）。I3 不變（suggestion 只到 hud、deck_update 只到 present）。
  - **web mp3-capture**: `startMp3Capture(file,cb,{speed,onProgress})`——decodeAudioData→OfflineAudioContext 重取樣 16k mono→Int16→250ms/frame 逐 frame `onFrame(ArrayBuffer)`；回傳與 `startCapture` 同形狀 `CaptureController`（getLevel/displaySurface/stop），跑完 `onEnded()`。frame 格式與生產 worklet 一字不差。
  - **web MeetingSimulator**（/sim，導覽「測試」群組可見，不隱藏）: 選/匯入 deck（輪詢 importStatus，failed 顯示 importError＋poppler 提示）→選 mp3→`createMeeting({title,deckId,companyId?})`→3 條 WS：capture（open 送 consent＋灌 mp3）、present（收 deck_update→縮圖列即時長出新頁、AI 補充頁標綠）、hud（`<HudInner embedded creds>` 真 transcript/signals/建議＋手動接受）。另可開 present/HUD 分頁。API base 顯示於頁面（本機/線上以對應前端開啟）。
  - **AppShell/i18n**: 新 nav 群組 `nav.test`→item `sim`（`/sim`, icon gauge）；messages 兩檔加 `nav.test`/`nav.sim`（parity 維持）。
- **為什麼**: 使用者要「匯入音檔模擬會議、看新 PPT 被插到後面」的測試管道；查出 append 生成觸發線為生產缺件，遂補真接線（使用者拍板：補真產品接線＋走真 HUD 手動批准＋入口可切本機/線上）。純新增產出者＋測試工具，不弱化 I1/I2/I3。
- **驗證**: server `tsc --noEmit` 綠、`vitest run` 44 檔 248 測全綠（含新 supplement-slide.test.ts 7 測：合格觸發/非合格不觸發/節流/配額/關閉/未設定/空頁不計）；web `tsc --noEmit` 綠、`next build` 17 路由綠（新增 /sim 6.7kB）；messages JSON parse OK＋nav.test/sim parity。未 commit（硬規則 10）。
- **審後修正（fresh-context 對抗驗證抓到 1 真 bug＋2 小瑕疵，全修）**: (1) **consent-on-open 競態**（真 bug、靜默失敗、本機低延遲最易中）——模擬器 capture 只在 WS open 送一次 consent，但 server runtime 由非同步 `ensureRuntime`（兩次 DB 讀後才 `sessions.set`）建立；consent 若早於 runtime→ws-server handler no-op 靜默丟棄→整場音訊被 consent gate 丟→零補充頁。修＝capture `onMessage` 收到 server 在 runtime 建好後才發的 `session_state` 時重送 consent（idempotent 兜底）。(2) 補充頁「本次新增」標記改用 `seedLen`（會議開始時 deck 頁數）取代 `originalCount`——對 native/generated deck（originalCount=0）也正確，不再把全部頁誤標。(3) orchestrator `companyName` 註解移除不實的「每場快取」字樣。三修後 web `tsc --noEmit` 綠。
- **/code-review 復審（5 視角 opus 並行→每筆對抗式評分→濾 ≥80）：raw 6→confirmed 1（全修）＋2 門檻下小瑕疵順修**:
  - **confirmed（80，warning，MeetingSimulator.tsx mp3-start effect）**: 該 effect 無 cleanup；`startMp3Capture` 要先 decode（數秒）才產生 controller，若解碼期間卸載/結束，卸載 effect 當下 `captureCtrlRef` 仍 null→stop() 空轉，controller 隨後才建、其 setInterval 對著關閉的 WS 空轉到整檔播畢（資源洩漏）。修＝加 `mountedRef`：解碼完成的 `.then` 檢查已卸載即 `c.stop()`；卸載 effect 設 `mountedRef=false`＋stop。**刻意放 ref 而非 start-effect cleanup**，避免 WS 每次重連（status 變動重跑 effect）誤停灌流。
  - **順修（門檻下，低風險利多）**: (a) seed `getDeck().catch` 不再吞錯——新 `deckErr` state，失敗顯示「⚠ deck 載入失敗」取代永遠「載入中…」＋避免 seedLen=0 誤標（score 44）。(b) `mp3-capture.decodeToPcm16` 加 `MAX_FILE_BYTES`(200MB) 前置守衛＋友善錯誤，擋超大檔吃爆分頁記憶體（score 28）。
  - **記為取捨不改**: orchestrator 每場配額只在成功計（空頁不計）＝刻意設計，spend 另由節流（樂觀佔窗 40s/次）bound，非 runaway，flash tier 成本極小（score 60，門檻下）；`SUPPLEMENT_TRIGGER_KINDS` 硬列字串＝合格訊號本就是 SIGNAL_KINDS 的刻意子集（score 13）；三視圖共置不破 I3＝broadcast role-filtered（正確判定非破壞，score 7）。修後 web `tsc --noEmit` 綠。

### 2026-07-19 23:58 | E2E 三尾巴（Threads 登入牆／finalHandles 二次社群抓取／FB·IG 摘要放寬）＋照片 v3（DOM 鄰近＋Google CSE）
- **工作區**: apps/server
- **類型**: fix＋feat
- **檔案**: `apps/server/src/research/social/threads.ts`, `apps/server/src/research/social/threads-login-wall.test.ts`(新), `apps/server/src/research/orchestrator.ts`, `apps/server/src/research/deep-extractor.ts`, `apps/server/src/research/photo-hunt.ts`, `apps/server/src/research/photo-hunt.test.ts`, `apps/server/src/research/photo-cse.ts`(新), `apps/server/src/research/photo-cse.test.ts`(新), `apps/server/src/config.ts`, `apps/server/src/research/routes.ts`, `.env.example`
- **改了什麼**:
  - **[1] Threads 登入牆偵測**（threads.ts）: 新純函式 `export isLoginWallContent(finalUrl, posts)`——finalUrl 轉去 `/login` 或 `/accounts/login`→直接判死；否則掃抽出「貼文」合併文字命中 ≥2 條 `LOGIN_WALL_MARKERS`（scan to get the app／log in with／forgot password／continue with instagram／terms of use…共 9 條）→判死。fetcher 於 slice 後、落庫前呼叫，命中即整平台 skip＋log「threads login wall — skipping」。加 6 測（含 E2E 實錄 9 條 UI 字串 fixture）。
  - **[2] 本地髒資料清理**（scratchpad 一次性腳本，不進 repo）: 刪 `apps/server/data/meetcopilot.db` 的 `company_social_posts` 中 platform=threads 且 url LIKE `%/login%` 的列。刪 1 列（Connact：url=`https://www.threads.com/login/?next=…@connact.tw…`，title「Connact AI — Threads」）；threads posts 1→0、表總數 1→0。
  - **[3] finalHandles 回饋二次社群抓取**（orchestrator runDeep，社群落庫段 ~:1042 後）: 第一輪 social fetch 只用「種子」handle；官網爬蟲/deep grounding 才發現的 youtube/threads handle（finalHandles 有、socialHandles 種子沒有）在第一輪未被抓。新增有界二次 fetch——只跑新增平台（其餘平台傳空 handle 自然 skip）、共用「距軟 deadline 剩餘時間 ∩ 一次 social 預算」（<30s 則跳過）、try/catch best-effort，`second.posts` push 進 `socialPosts` 一起 bulkUpsert。log「social second pass: <platforms>」／「none discovered」／「skipped (deadline)」。這樣 grounding 發現的 YT 頻道才會觸發無金鑰 fallback、Threads 公開頁才會被抓。
  - **[4] FB/IG 摘要 0 筆放寬**（deep-extractor SYSTEM）: **根因判定＝非 wiring bug**——`buildSocialQueries`（angle='social'）的 grounded 答案確有進 `bundle.groundedFindings`，`buildPrompt` 的 `=== GROUNDED FINDINGS ===` 段把**全部** findings（含 [social]）映入 prompt，且在 docs 之前不受 180k 截斷影響。0 筆之因是 SYSTEM/schema 的門檻過嚴（原文要求「SUBSTANTIVE recent activity from the company's OWN account」，gemini 幾乎無法從 grounding 片段確證→整平台 OMIT）。改：只要 findings 含該平台**任一具體事實**（粉專/帳號存在、追蹤/按讚數、近期貼文/公告/活動、徵才貼文、評價口碑）就產 3-5 句繁中摘要、照來源說；完全無資料才 OMIT；仍嚴禁捏造（寧缺勿假）。socialSummaries 映射純函式與落庫路徑不動。
  - **[5] 照片 v3a 官網 DOM 鄰近匹配**（photo-hunt.ts findPersonPhotoInHtml）: alt 命中（pass1）之外，新增 pass2「鄰近 DOM 文字」——對每個 <img> 取前後 ~300 字元窗口（`proximityText`：先移除 title/script/style **內文**再去標籤，避免 `<title>Jane Doe</title>` 讓 body 無關圖誤中→修回歸），沿用 `textHasName`（CJK 子字串／拉丁詞界）命中即候選；佔位圖黑名單/追蹤像素/scheme 守衛全沿用（`toUsablePhoto`）；alt 命中優先於鄰近命中；og:image（title-gated）維持 pass3。新 export `isUsablePhotoUrl(url)`（絕對圖 URL 套同組守衛，供 v3b 共用）。加 6 測（無 alt 團隊頁 `<h4>程峻宏</h4><img>`、拉丁 figcaption、alt 優先、佔位圖守衛、距離守衛、isUsablePhotoUrl）。
  - **[6] 照片 v3b Google 圖片 CSE**（photo-cse.ts 新）: env `GOOGLE_CSE_API_KEY`＋`GOOGLE_CSE_CX` 皆存在才啟用（缺任一優雅 skip＋config 一次性 warning，比照 YOUTUBE_API_KEY）。`config.ts` 加讀取＋AppConfig 兩欄、`.env.example` 加註解；`routes.ts` 兩者皆設才傳 `googleCse` 給 orchestrator。`searchPersonPhotoCse(cfg,name,company)`：`undici` 直打 `www.googleapis.com/customsearch/v1`（固定 API 網域、非 SSRF 面）searchType=image、num=4、safe=active；純函式 `pickCseImage` 取前 4 結果過既有守衛的第一張原圖 link＋contextLink。enrichKeyPeople 於官網/citation（v1 alt/鄰近＋v2 專屬查詢）落空後→查「<中文名 ?? name> <公司名>」寫 photoUrl confidence 0.5＋provenance（sourceUrl=contextLink ?? link）；每人 1 次、每 job ≤5 次（`PHOTO_CSE_MAX_PER_JOB`＋`cseQueriesUsed`）。加 7 測（回應解析＋守衛＋只掃前 4＋未設定憑證不打 API）。
- **為什麼**: E2E 走查揪出三尾巴（Threads 把登入頁當貼文落庫、grounding 發現的社群 handle 未回饋抓取、FB/IG 摘要恆為 0）＋主管照片命中率補強（無 alt 團隊頁 DOM 鄰近、官網/citation 落空後的 Google 圖片備援）。純研究/落庫路徑，不動 deck patch/approval/HUD，不違反 I1/I2/I3；沿用 provenance「值與來源同一 tx」與雙語不變量；CSE 為固定公開 API 網域、憑證只進 env 絕不落碼/落庫/落 log。
- **驗證**: `apps/server npx tsc --noEmit` 綠（EXIT=0）；`npx vitest run` 43 檔 **241 測全綠**（基準 222＋新增 19：threads-login-wall 6／photo-cse 7／photo-hunt +6）。v3a proximity 一度回歸 og:image 既有測（窗口誤收 `<title>` 文字），以 `proximityText` 移除 title/script/style 內文修正。Item 2 一次性腳本實跑：刪 Connact 1 列（1→0）。未 commit（硬規則 10，等使用者核准）。

### 2026-07-19 23:50 | S4 修復：FB/IG「動態摘要（AI 整理）」落庫冪等——落庫前刪同平台既有摘要列
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/research/orchestrator.ts`
- **改了什麼**（S4 社群摘要落庫段 ~:1047–1075，`runDeep` 內）:
  - 摘要建構迴圈額外累積 `summaryKeys: {platform, title}[]`（與 `summaryPosts` 同步、每筆帶固定 title 常數）。
  - 落庫前對 `summaryKeys` 逐筆 `core.db.run("DELETE FROM company_social_posts WHERE org_id=? AND company_id=? AND platform=? AND title=?")` 刪同平台既有 AI 摘要列，再 `companySocial.bulkUpsert(allSocialPosts)`。delete 全在既有 best-effort `try/catch` 內。
  - Before: 直接 `bulkUpsert`，倚賴自然鍵 `[platform,url]` 冪等。After: 先刪同平台固定-title 摘要列再 upsert，保證每平台至多一筆。
- **為什麼**（code-review confirmed，medium）: AI 摘要貼文的自然鍵 `[platform,url]` 在 **url 為 null**（`finalHandles[platform]` 無帳號連結、`sourceUrl` 亦無/deep-extractor RESPONSE_SCHEMA 未強制 sourceIndex）時，`child-upsert.ts matchRow`（:45–47 遇 null 鍵欄回 undefined）強制 INSERT；且跨輪 url 變動（run1=citation → run2=帳號連結）也產生第二列。→ 每次 deep-research 都新增「Facebook/Instagram 動態摘要（AI 整理）」列、永不去重也永不刪除，累積重複。此 no-url 情境正是 SocialTab W2（無 url→heading 純文字）刻意支援者，故不能改用 synthetic url 冒充連結誤導 UI；改以「platform+固定 title」刪除鍵達成冪等，保留 url=null 的顯示語意。真實 fetcher 貼文（youtube/threads…）title 不同、不受刪除影響。
- **不變量**: 純研究資料層社群子表落庫，不動 deck patch/approval/HUD；沿用 provenance 慣例。不違反 I1/I2/I3。
- **驗證**: `apps/server npx tsc --noEmit` 綠（EXIT=0）；`npx vitest run` 41 檔 **222 測全綠**（無新增測；orchestrator 落庫路徑非既有測覆蓋，社群摘要映射純函式測 `social-upgrade.test.ts` 不受影響仍綠）。未 commit（硬規則 10，等使用者核准）。

### 2026-07-19 20:07 | 社群升級 server 包 S1–S6：筆記 redirect 降級＋YouTube 無金鑰爬取＋Threads 推導＋FB/IG 摘要＋照片 v2
- **工作區**: apps/server
- **類型**: feat
- **檔案**: `apps/server/src/research/orchestrator.ts`, `apps/server/src/research/deep-extractor.ts`, `apps/server/src/research/social/youtube.ts`, `apps/server/src/research/social/discover.ts`, `apps/server/src/research/social/index.ts`, `apps/server/src/research/social-upgrade.test.ts`(新), `apps/server/src/research/note-source-suffix.test.ts`(新)
- **改了什麼**:
  - **S1 筆記來源洩漏雙修**（orchestrator）: 新增純函式 `export noteSourceSuffix(url)`——真實出處→`（[來源](url)）` markdown 連結；`isGroundingRedirect` 命中（vertexaisearch/googleusercontent/grounding-api-redirect 中介 302）→降級純文字「（來源待解析）」不掛連結。`writeSingletonNotes`（未歸類情報＋研究商機線索兩段）與 `writeCompetitorsNote`（Before: `（來源：${url}）` 純文字 → After: `noteSourceSuffix`）皆改用之。`resolveMerged` 內 `resolveRedirects` 補 `max: 48`（Before 預設 16；併入 uncategorized/opportunities/社群來源後待解析 redirect 變多、16 會截斷）。
  - **S2 YouTube 無金鑰 fallback**（youtube.ts）: `createYoutubeFetcher(apiKey, crawler?)`——apiKey 空且有 youtube handle→改用 `crawler.fetchRaw`（Playwright）抓頻道 `/videos` 頁、解析 `ytInitialData`。新純函式（皆 export 供測）：`youtubeVideosUrl`（handle/URL→/videos）、`extractYtInitialData`（平衡括號忽略字串內轉義擷取 JSON）、`parseYtInitialData`（遞迴收集新 `lockupViewModel`＋舊 `videoRenderer`，去重、≤15）、`parseViewCount`（千分位＋K/M/B＋中文萬/億，抽不到 undefined）、`parseRelativeDate`（zh 分鐘/小時/天/週/個月/年前＋en ago→now-offset epoch，解析不了 null）。整段 try/catch 失敗回空、不害 job。index.ts `createSocialFetchers` 傳 crawler 給 youtube fetcher。
  - **S3 Threads handle 推導**（discover.ts）: `discoverHandles` 收尾——threads 缺且 instagram 存在→`threads=https://www.threads.net/@<igUsername>`（新 export `instagramUsername`：取 path 首段、去 @、擋保留路徑 p/reel/reels/explore/…）；下游 threads.ts 解析不到內容照舊優雅 skip。
  - **S4 FB/IG 動態摘要**（deep-extractor＋orchestrator）: `DeepExtraction` 加 `socialSummaries?:{platform:facebook|instagram, summaryZh, sourceUrl?}[]`＋RESPONSE_SCHEMA（platform enum、summaryZh、sourceIndex）＋SYSTEM 指示（僅實質動態才產、繁中 3-5 句、嚴禁捏造、sourceUrl 取真實 citation）；新 helper `toDeepSocialSummaries`（platform 白名單、每平台至多一筆、sourceIndex→真實 URL 不 fallback primary）。orchestrator 社群落庫段把 `deep.socialSummaries`→`NewSocialPost`（title=「Facebook/Instagram 動態摘要（AI 整理）」、content=summaryZh、url=`finalHandles[platform] ?? cleanUrl(sourceUrl)`、publishedAt 留空），併入 socialPosts 一起 `bulkUpsert`（自然鍵 platform+url 冪等）；`finalHandles` hoist 出 try 供引用。
  - **S5 照片 v2**（orchestrator enrichKeyPeople）: 背景 citation 仍無 photoUrl 者→加一條專屬照片 grounded 查詢（cjk 名→「<中文名> <公司> 專訪 OR 照片」否則 en「<name> <company> interview photo」），取 citations 前 2 URL `fetchRaw` 跑既有 `findPersonPhotoInHtml`（詞界/佔位圖黑名單守衛沿用；≤2 fetch；命中寫 photoUrl confidence 0.5＋provenance）；逐項前檢查 deadline。
  - **S6 測試**: `social-upgrade.test.ts`（20 測：ytInitialData 新舊結構解析＋上限＋容錯、parseViewCount zh/en、parseRelativeDate zh/en、youtubeVideosUrl、threads 推導、socialSummaries 映射）；`note-source-suffix.test.ts`（3 測：真實連結／redirect 降級／空字串）。
- **為什麼**: RESEARCH_UPGRADE 社群升級——AI 敘事/競品/觀察筆記的 grounding-redirect 來源改由 react-markdown 渲染後會變成可點假連結，須降級；YouTube 無官方金鑰時仍能靠 Playwright 補齊近期影片；IG↔Threads 同名帳號補推導；FB/IG 只走 grounding 的實質動態轉結構化貼文落庫；主管頭像補一條專屬查詢提高命中。
- **不變量**: 純研究資料層＋筆記顯示層，不動 deck patch/approval/HUD；照片/社群摘要皆嚴禁捏造（守衛/白名單沿用），redirect 降級強化 provenance 誠實。不違反 I1/I2/I3。
- **驗證**: `apps/server npx tsc --noEmit` 綠（EXIT=0）；`npx vitest run` 41 檔 **222 測全綠**（基準 199＋新 23）。未 commit（硬規則 10，等使用者核准）。

### 2026-07-19 23:15 | 筆記 body 以 react-markdown 渲染（AI 敘事筆記富文字＋連結 scheme 白名單）
- **工作區**: apps/web
- **類型**: feat
- **檔案**: `apps/web/components/crm/NotesTab.tsx`, `apps/web/app/globals.css`, `apps/web/package.json`（+react-markdown ^9.1.0）, `package-lock.json`（依賴解析，預期變更）
- **改了什麼**:
  - **NotesTab.tsx**: 筆記 body（原 `<div className="mc-noteitem__body">{n.body}</div>`）改以 `<ReactMarkdown>` 渲染，容器加掛 `.mc-md` 範疇 class。
    - `urlTransform`＝新純函式 `mdUrlTransform`：只放行絕對 `http`/`https` 與 `mailto`，其餘（`javascript:`/`data:`/相對路徑/fragment/空字串）回 `undefined` → react-markdown 不掛 href、連結失效（XSS 縱深客戶端第二道，與 SocialTab `httpUrl` 同慣例）。
    - `components.a` 覆寫（`MC_MD_COMPONENTS`）：一律 `target="_blank" rel="noopener noreferrer"`，並把 react-markdown 注入的 `node` prop 解構丟棄不外洩到 DOM。
    - **未裝 rehype-raw**：body 內原始 HTML 天然被跳脫、不會執行（預設安全）。
  - **globals.css**: notes 區塊後新增 `.mc-md` 範疇樣式（h2/h3/h4 字級與上下間距、p/ul/ol/li、a 色＝`--mc-accent`＋hover、strong/em、code/pre、blockquote、hr；`:first-child`/`:last-child` 去頭尾邊距）。`.mc-md { white-space: normal }` 覆寫 `.mc-noteitem__body` 的 `pre-wrap`（本規則定義在後故同 specificity 勝出），把區塊排版交還 markdown、避免 block 間殘留換行造成空隙。全部沿用既有 `--mc-*` token。
  - **SocialTab.tsx（W2）**: 確認即可、**未改**——`SocialPostRow` 在 `httpUrl(post.url)` 為 null（AI 摘要無帳號連結情境）時 heading 已渲染純文字（不掛 href），既有行為即符合契約。未新增可見字串，故 messages 兩檔無需新鍵。
- **為什麼**: server 端 AI 敘事筆記（note_type='narrative'）body 以 markdown 產出（標題/清單/粗體/citation 連結），先前直接當純文字塞進 `<div>`，`##`/`**`/`[]()` 原樣顯示、citation 不可點。改用 react-markdown 正確渲染富文字並統一連結安全策略。
- **不變量**: 純前端顯示層，不動 deck patch/approval/HUD；連結白名單強化 XSS 縱深。不違反 I1/I2/I3。
- **驗證**: `apps/web npx tsc --noEmit` 綠；`NEXT_PUBLIC_API_BASE=http://localhost:8080 npx next build` 綠（4/4 靜態頁生成、`/[locale]/crm/[id]` 因 react-markdown 由 ~44→47.9 kB，預期）。未 commit（硬規則 10，等使用者核准）。

### 2026-07-19 22:10 | DynamicSlide 匯入徹底重構——保留原簡報＋尾端 append（獨立 worktree 分支）
- **工作區**: packages/shared, packages/crm, apps/server, apps/web, tools(Dockerfile.server)
- **類型**: feat
- **隔離**: 全部在 git worktree 分支 `worktree-dynamicslide-preserve-original`（從 HEAD 585a077 分出），**主樹那批未提交的 research/social 工作原封未動**（使用者拍板獨立 worktree 隔離）。以下檔案指 worktree 分支內。
- **檔案（新增）**: `packages/crm/migrations-pg/018_deck_import.sql`, `packages/crm/migrations/018_deck_import.sql`, `packages/crm/src/repos-deck-assets.ts`, `packages/crm/src/repos-import-jobs.ts`, `apps/server/src/lib/signed-url.ts`, `apps/server/src/decks-routes/assets-route.ts`, `apps/server/src/decks-routes/import-handler.ts`, `apps/server/src/decks-routes/export-handler.ts`, `apps/server/src/import/deck-rasterize.ts`, `apps/server/src/import/conversion-job.ts`(+test), `apps/server/src/generation/pptx-merge.ts`(+test), `apps/server/src/generation/pdf-merge.ts`(+test), `apps/server/src/generation/supplement-render.ts`, `apps/server/src/generation/canvas-size.ts`
- **檔案（改）**: `packages/shared/src/deck.ts`, `packages/crm/src/{ports,core,index,repos-decks}.ts`, `packages/crm/test/crm-core.test.ts`, `packages/crm/test/decks-repo.test.ts`, `apps/server/src/decks-routes/index.ts`, `apps/server/src/index.ts`(boot reaper+對帳), `apps/server/src/import/pptx-parser.ts`, `apps/server/src/generation/pptx-render.ts`, `apps/server/src/crm-routes/helpers.ts`, `apps/server/package.json`(+pdf-lib), `apps/web/lib/api.ts`, `apps/web/components/studio/{StudioView,SlideEditor}.tsx`, `apps/web/components/present/PresentStage.tsx`, `apps/web/components/slide/SlideRenderer.tsx`, `apps/web/messages/{en,zh-TW}.json`, `Dockerfile.server`
- **改了什麼**（架構重構，根因＝匯入把 pptx/pdf 拆成純文字＋平台模板重畫、丟棄原檔）:
  - **匯入**（import-handler）: 修 multer 檔名編碼(latin1→utf8)＋讀真標題(docProps/core.xml / pdf metadata)；原檔位元組存 `deck_assets(source_pptx|source_pdf)`；建 `import_status='processing'` deck；enqueue 背景轉檔 job；廢除舊「extractSlideBlocks 拆文字建 deck」路徑（pptx-parser 只留 theme/title）。
  - **轉檔 job**（deck-rasterize+conversion-job）: pptx→`soffice`→pdf→`pdftoppm`→PNG；pdf→`pdftoppm`→PNG（免 LibreOffice）；逐頁存 `deck_assets(page_image)`＋建 N 筆 `deck_slides(kind='original')` image-full spec（dataUri=內部參照 `asset:<id>`）；設 original_count/import_status。boot reaper（failInterruptedJobs）＋**開機對帳 failInterruptedImports**（processing deck→failed，修中斷卡死）。
  - **顯示**: getDeck route 把 `asset:<id>` 換 HMAC 簽章短效 URL（signed-url.ts，TTL 預設 8h）；asset 串流端點（assets-route，免 authRequired、純簽章＋org 綁定）；前端 `<img>` 吃簽章 URL、每 30 分續簽。
  - **鎖定**（I1/I2）: `deck_slides.kind='original'` → `updateSlide` guard 拒改（OriginalSlideLockedError→409）；前端原始頁唯讀面板＋縮圖鎖。append 仍只尾端。
  - **匯出雙路**（export-handler）: pptx 來源→補充頁 pptxgenjs→**jszip 嫁接**回原 pptx（可編 pptx，含 app.xml 頁數/多 layout/撞名避讓/就地覆寫省 recompress）；pdf 來源→補充頁→pdf→**pdf-lib** 接原 pdf；0 補充頁回原檔 bytes；補充頁以**原檔畫布尺寸**渲染(canvas-size 讀 sldSz/pdf 頁尺寸，修寬螢幕破版)。
  - **Docker**: apt 疊 `libreoffice-impress poppler-utils fonts-noto-cjk`（+~1GB，中文渲染硬需求）。
- **為什麼**: 使用者匯入設計精美簡報後發現變成「另一份純文字簡報」（標題亂碼、heading 全 Page、bullets 夾 CONNACT/頁碼、視覺全失）。重構＝保留原簡報視覺原封（原檔存 bytes＋轉圖顯示＋鎖定）、只尾端 append 補充頁、匯出＝原簡報＋新頁。
- **不變量**: I1（原始頁 kind guard＋append 尾端不動已播/原始頁）、I2（approval gate 未動）、I3（播放視圖零 HUD、簽章 URL/原始頁/匯入進度不外流）皆保留；Phase 3 五維對抗式審查確認零違反。
- **migration 撞號注意**: 本支用 **018**（主樹 research 工作已佔 016_social_tech/017_more_mode）；crm-core.test 冪等測試改 gap-tolerant（平行分支合法產生版本間隙，保「版本唯一＋重跑穩定」）。merge 時確認 018 不與屆時主樹最高號相撞。
- **驗證**: typecheck 5 workspace 全綠；crm 50 測、server 163 測綠；Phase 3 對抗式審查 4 confirmed（migration 撞號/匯入卡死/補充頁尺寸/簽章 TTL）**全修**；/code-review ≥80 confirmed **0**；/simplify 14 建議套 6（去重/就地嫁接/刪死碼/並行讀）；**Docker 真檔 E2E 3 案例全綠**（PDF 19→21頁、真 pptx 16→18 slide、寬螢幕補充頁滿版；中文轉檔像素忠實、`unzip -t`/`pdfinfo` 無錯）。未 commit（硬規則 10，等使用者核准）。

### 2026-07-19 20:30 | code-review 後四筆修復：社群 URL XSS 縱深＋photo-hunt attr 詞界＋CJK 誤組護欄＋dedupe 尾段軟 deadline
- **工作區**: apps/server, apps/web, packages/crm
- **類型**: fix
- **檔案**: `apps/server/src/crm-routes/companies.ts`, `apps/web/components/crm/SocialTab.tsx`, `apps/server/src/crm-routes/companies-social.test.ts`(新增), `apps/server/src/research/photo-hunt.ts`, `apps/server/src/research/photo-hunt.test.ts`, `packages/crm/src/contact-merge.ts`, `packages/crm/src/contact-merge.test.ts`, `apps/server/src/research/orchestrator.ts`
- **改了什麼**:
  - **(1) 社群 URL 全鏈路 scheme 白名單（XSS 縱深，契約三）**:
    - **companies.ts**: `GET /companies/:id/social` 的 `put()` inline helper（Before: `if (typeof val==="string" && val.trim().length>0) links[key]=val.trim()`）抽成 exported 純函式 `buildSocialLinks(company)`＋`sanitizeSocialPosts(posts)`，改用 `cleanUrl`（複用 `../research/extract-shared.js`）——只收絕對 http(s)，`javascript:`/`data:`/相對路徑一律不進 links；posts 的 url 非 http(s) → 剝除為 undefined（其餘欄不動）。
    - **SocialTab.tsx**: 新增 `httpUrl(u)` scheme 驗證（絕對 http(s) 才回值）。帳號連結（原 `:120`）非 http(s) → 改渲染 `<span>` 純文字（不掛 href）；貼文連結（原 `:164`）非 http(s) → heading 純文字。
    - **companies-social.test.ts**（新增 5 測）: `buildSocialLinks`/`sanitizeSocialPosts` 對 javascript:/data:/vbscript:/相對路徑過濾＋curated 單欄勝＋合法 http(s) 保留。
  - **(2) photo-hunt attr() 正則詞界（photo-hunt.ts:77）**: Before `\\b${name}\\s*=`——`\b` 把連字號當詞界，`attr("alt")` 誤中 `data-alt`、`attr("src")` 誤中 `data-src`（抓錯照片）。After `(?:^|[\\s"'])${name}\\s*=`（屬性名前須為行首/空白/引號）。+2 regression 測（data-alt/data-src 干擾屬性、僅 data-src lazy-load 由 `?? attr("data-src")` 顯式取）。
  - **(3) contact-merge CJK 誤組護欄（contact-merge.ts `extractEmbeddedCjkName` ~:125）**: 抽出的 CJK 段當人名鍵前加兩護欄——(a) `[...seg].length` 須 2–4 字（≥5 多為機構/描述如「台北辦公室」）；(b) `CJK_NON_NAME_STOPLIST`（台北/台中/公司/集團/董事…完全相等才擋）。只看第一段連續 CJK，不合即 undefined 改走羅馬拼音橋接。+3 測（John(台北)≠Mary(台北)、≥5 字段不組、程峻宏 regression 照常入組）。
  - **(4) dedupe 尾段軟 deadline（orchestrator.ts `runDeep` ~:1045）**: `dedupeCompanyContacts` 前加 `if (Date.now() > runDeadlineAt)` 守衛（比照 `enrichKeyPeople` 記債）——超過軟 deadline 就 `console.warn` 並跳過 dedupe。dedupe 是多步 delete+rebuild（刪 stale 卡→改欄→靠收尾 reindex 重建），逼近硬 kill 才起跑會被 withTimeout 打斷成半套（stale 卡已刪、reindex 未跑）；跳過後未收斂列下輪研究再收斂。
- **為什麼**: code-review 五鏡頭發現的四筆問題（XSS 縱深缺 server+client 雙層白名單；attr `\b` 連字號誤配；CJK 內嵌抽取把地名/機構誤當人名鍵；dedupe 無軟 deadline 有半套風險）。
- **不變量**: (1) 強化契約三（HUD/資料不外流之外，補 stored-URL XSS 縱深）；(3)/(4) 屬 CRM／研究層資料收斂，不動 deck patch/approval/HUD。不違反 I1/I2/I3。
- **驗證**: `packages/crm npx vitest run` 64 測全綠（基準 61，+3）；`apps/server npx tsc --noEmit` 綠、`npx vitest run` 188 測全綠（基準 181，+7=companies-social 5＋photo-hunt 2）；`apps/web npx tsc --noEmit` 綠。未 commit（硬規則 10）。

### 2026-07-19 19:45 | 會中進行 cockpit /simplify：3 項行為不變清理（死 radius fallback／單子 <g>／靜態預覽 URL 收斂）
- **工作區**: apps/web
- **類型**: refactor
- **檔案**: `apps/web/app/globals.css`, `apps/web/components/copilot/CockpitView.tsx`, `apps/web/lib/meeting-session.ts`, `apps/web/components/studio/SlideEditor.tsx`
- **改了什麼**:
  - **globals.css**: `.mc-cockpit__second-qr`／`.mc-cockpit__second-link` 的 `border-radius: var(--mc-r-md, 8px)`→`var(--mc-r-md)`（--mc-r-md 於 :root 已定 12px，8px fallback 永不觸發且值不符；渲染半徑不變）。
  - **CockpitView.tsx**: QR 佔位內只包單一 <rect> 的 `<g fill opacity>` 折進 rect（`<g fill="currentColor" opacity="0.35"><rect .../></g>`→`<rect ... fill="currentColor" opacity="0.35" />`）；另一個共用 stroke 的四路徑 finder-mark <g> 保留；渲染相同。
  - **meeting-session.ts**: 新增 `buildStaticPresentUrl(deckId)`＝復用私有 `absoluteInApp`（`/present?deckId` only、無 meeting/token）。
  - **SlideEditor.tsx**: openStaticPreview 由手拼 `${origin}/${locale}/present?deckId=` 改呼 buildStaticPresentUrl；移除只剩此路徑在用的 useLocale import＋const locale＋useCallback deps 的 locale（locale 來源收斂為 currentLocale 單一）。live-play（openLivePlay/buildPresentUrl）不動。
- **為什麼**: /simplify 四鏡頭 10 候選收斂為 3 行為不變清理（reuse／altitude／simplification）。/code-review 五鏡頭同輪零高信心問題（8 raw→0 confirmed ≥80，I1/I2/I3 再查皆成立）。
- **不變量**: 純美學／URL 收斂，不動 deck patch／approval／HUD；`buildPresentUrl` 必帶 present-role token 的契約保留（另開 buildStaticPresentUrl 而非把 creds 改可選）。不違反 I1/I2/I3。
- **驗證**: apps/web `tsc --noEmit` exit 0 零診斷；靜態預覽 URL byte-identical（URLSearchParams 與 encodeURIComponent 同編碼、currentLocale 讀同一 path 段）。未 commit（硬規則 10）。

### 2026-07-19 14:36 | simplify 化簡：CRM 五指令輪未 commit 變更——import 收斂＋社群平台常數單一真源
- **工作區**: packages/crm, apps/server
- **類型**: refactor
- **檔案**: `packages/crm/src/repos-social.ts`, `apps/server/src/research/orchestrator.ts`, `apps/server/src/research/more-mode.ts`
- **改了什麼**（保功能化簡，三處，皆零行為變更）:
  - **repos-social.ts import 收斂**: 同模組兩行 type import 併一行。Before: `import type { DbPort } from "./ports.js";` ＋ `import type { CompanySocialRepository } from "./ports.js";`。After: `import type { DbPort, CompanySocialRepository } from "./ports.js";`（對齊檔內慣例）。
  - **orchestrator.ts import 收斂**: `@meetcopilot/crm` 的 type-only 與 value import 兩行併一行。Before: `import type { CrmCore } from "@meetcopilot/crm";` ＋ `import { dedupeCompanyContacts } from "@meetcopilot/crm";`。After: `import { dedupeCompanyContacts, type CrmCore } from "@meetcopilot/crm";`（沿用檔內既有 inline `type` 混寫慣例，如 deep-research 的 `type SourceText`）。
  - **社群平台清單單一真源（重複收斂）**: `["youtube","facebook","instagram","threads"]` 原在 more-mode.ts（`SOCIAL_PLATFORMS`，供 `buildMoreGapQueries` 判缺）與 orchestrator.ts `buildMoreGapSeeds`（inline 算 `socialPlatformsPresent`）各存一份、須手動同步。改為 more-mode 的 `SOCIAL_PLATFORMS` 加 `export`，orchestrator 改 `SOCIAL_PLATFORMS.filter((p) => handles[p])`。producer/consumer 共用同一常數，杜絕漂移。新增 export 不改既有簽名。
- **為什麼**: 本輪 RESEARCH_UPGRADE v2（社群/技術棧/more/照片）未 commit 變更的收尾化簡。只做 import 收斂與重複域常數收斂；child-upsert `matchRow` 抽取、contact-merge、more-mode/photo-hunt 純函式等既已乾淨，刻意不動（見回報）。純資料層/研究層，不動 deck patch/approval/HUD，不違反 I1/I2/I3。
- **驗證**: `packages/crm npx vitest run` 8 檔 61 測全綠；`apps/server npx tsc --noEmit` 綠、`npx vitest run` 35 檔 181 測全綠。未動 web（本輪 web 檔已乾淨）；未 commit（硬規則 10）。

### 2026-07-19 19:20 | E2E 尾巴修復：contact dedupe CJK 內嵌抽取＋羅馬拼音等值橋接｜photo-hunt 佔位/預設圖黑名單
- **工作區**: packages/crm, apps/server
- **類型**: fix
- **檔案**: `packages/crm/src/contact-merge.ts`, `packages/crm/src/contact-merge.test.ts`, `apps/server/src/research/photo-hunt.ts`, `apps/server/src/research/photo-hunt.test.ts`
- **改了什麼**:
  - **尾巴1 dedupeCompanyContacts 漏併（contact-merge.ts）**: 舊版只按「非空 full_name_zh」trim 分組——同一人的英文變體（full_name_zh 空）落單不併。E2E 實測 Connact AI 殘餘 3 列程峻宏未收斂。新增兩段保守分組（`groupContactRows`:159）：**(1) CJK 內嵌抽取**（`extractEmbeddedCjkName`:125，正則 `/[㐀-鿿豈-﫿]{2,}/`）——full_name_zh 空但 full_name 內含 ≥2 字連續 CJK 段（如「Cheng Chun-hung (程峻宏)」）→抽出中文段當 zh 鍵；合併時（`mergeGroup` backfillZh 參數，:382）把該中文名回填 survivor 空的 full_name_zh。**(2) 羅馬拼音正規化嚴格全等橋接**（`normalizeRomanName`:137——去括號內容/lowercase/去所有非 a-z0-9）——仍無鍵的列先橋接到某 zh 群成員（該成員 full_name 正規化相等，如「Cheng Chun-Hung」→chengchunhung == B 去括號後 chengchunhung），否則彼此相等才成新羅馬群。**嚴格全等、零模糊**：David Chen(davidchen)≠David Cheng(davidcheng) 不併。群鍵優先序 zh>羅馬（羅馬鍵只在能橋接 zh 群或彼此相等時成群）。survivor 選法/human-verified 護欄/re-point/provenance 併入**全不動**。Before: `const key=(r.full_name_zh??"").trim(); if(!key) continue;`（英文變體被 `continue` 丟棄）。After: `groupContactRows(rows)` 兩段分組＋回填。SELECT 加 `full_name` 欄。
  - **尾巴2 photo-hunt 抓到佔位圖（photo-hunt.ts）**: 實測填入 `https://www.niea.org.tw/public/element/FB_default_image.jpg`（FB 預設佔位圖）。新增 `PLACEHOLDER_PATH_RE`（:28，`/(?:default|placeholder|blank|no[-_]?image|fallback|dummy|sprite|spacer)/i`，涵蓋 fb_default/og-default/avatar-default 等 *-default）；`toUsablePhoto` 改回傳前多過一關 `if (PLACEHOLDER_PATH_RE.test(u.pathname)) return undefined`（:96，比對整個 URL path、大小寫不敏感）。因 alt 命中與 og:image 兩條路徑皆經 `toUsablePhoto`，故一處守衛兩路都過。
- **為什麼**: E2E 實測 Connact AI 揪出兩尾巴。dedupe 修法「保守零模糊」（僅 CJK 內嵌＋羅馬嚴格全等橋接，不做部分匹配），既知風險不變（同名不同人的 zh 鍵仍會併）。純 CRM 資料層＋研究解析，不動 deck patch/approval/HUD，不違反 I1/I2/I3。
- **驗證**: `packages/crm npx tsc --noEmit` 綠、`npx vitest run` 8 檔 61 測全綠（contact-merge.test.ts 8→12：程峻宏三變體 3→1／CJK 抽取回填／David Chen≠Cheng 不併／同名陳志明仍併）；`apps/server npx tsc --noEmit` 綠、`npx vitest run` 35 檔 181 測全綠（photo-hunt 7→9：FB_default alt+og:image 兩路擋＋真照片仍取／placeholder/no-image/avatar-default/blank/dummy/fallback 皆擋）。**實資料驗收**（一次性 .mjs，scratchpad 未進 repo，自帶 busy_timeout DbPort 與 live server 併存，唯讀 .env）：對 Connact AI（org 019f59d7…/company 019f59d8…）先 log 合併計畫再執行——3 列程峻宏（「Cheng Chun-Hung」zh空最舊＝survivor／「Cheng Chun-hung (程峻宏)」zh空／「Troy」zh程峻宏）收斂為 1，`{groupsMerged:1,contactsRemoved:2,groupsSkipped:0}`，總列 7→5，survivor full_name_zh=程峻宏（fill-empty＋backfill）、title/title_zh 累加（上限 4 段）、其他 4 人（李光斌/廖柏維/高全德/李芳葦）零受影響；photo_url 那張 FB_default 佔位圖 UPDATE 為 NULL，複查 DB 內 FB_default 殘留＝0。未 commit（硬規則 10）。

### 2026-07-19 18:10 | migration 017：crawl_jobs.mode CHECK 放寬納入 'more'（修 enrich mode=more 400 CHECK failed）
- **工作區**: packages/crm
- **類型**: fix
- **檔案**: `packages/crm/migrations/017_more_mode.sql`(新), `packages/crm/migrations-pg/017_more_mode.sql`(新)
- **改了什麼**:
  - **根因**: RESEARCH_UPGRADE v2 已在 routes/orchestrator/shared 導入 `mode='more'`（「研究更多」補缺升級），但 DB 層漏做 migration——`crawl_jobs.mode` 的 CHECK 仍是 `IN ('quick','detailed','deep')`（010 定），故 `POST /api/crm/.../enrich` 帶 `mode=more` 落 crawl_jobs 時 CHECK constraint failed → 400。E2E 才暴露。
  - **SQLite 017**: SQLite 無法 ALTER CHECK，沿用 010 的「建 `crawl_jobs_new`→`INSERT SELECT` 搬全部列→`DROP` 舊表→`RENAME`→重建 `idx_crawl_jobs_org_target`」重建。新表欄位/索引與 010 重建後的 crawl_jobs **一字不差**（006/010 後無他 migration 動過本表，已 grep 確認），僅 mode 的 CHECK 由 `IN ('quick','detailed','deep')`→`IN ('quick','detailed','deep','more')`。既有 job 列（研究執行簿記）完好搬運。
  - **PG 017**: `ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_mode_check;` ＋ `ADD CONSTRAINT crawl_jobs_mode_check CHECK (mode IN ('quick','detailed','deep','more'));`（沿用 010 pg 版慣例——PG 對表級 CHECK 自動命名 `<table>_<col>_check`；`IF EXISTS` 防呆，純新庫走 head 亦不報錯）。
- **為什麼**: 補上 v2 `more` 模式漏掉的 DB migration，讓「研究更多」不再 400。純簿記表 CHECK 放寬，不動 deck patch/approval/HUD，不違反 I1/I2/I3。
- **驗證**: `packages/crm npx vitest run` 8 檔 57 測全綠（admin-migration 跑全套至 head，含 017）；一次性腳本（scratchpad，未進 repo）對全新 in-memory SQLite 依序套 001–017 後：`INSERT mode='more'` **成功**（row.mode='more'）、`INSERT mode='bogus'` **仍被擋**（CHECK constraint failed: mode IN ('quick','detailed','deep','more')）、quick/detailed/deep 皆仍 OK。`apps/server npx tsc --noEmit` EXIT 0 無波及。未 commit（硬規則 10）。

### 2026-07-19 17:20 | 會中進行收斂：導覽剩兩入口＋/hud 降級＋收音摩擦精簡＋帳號A 一鍵開簡報
- **工作區**: apps/web
- **類型**: feat
- **檔案**: `apps/web/lib/meeting-session.ts`(+buildPresentUrl/buildHudUrl), `apps/web/components/AppShell.tsx`, `apps/web/components/home/HomeDashboard.tsx`, `apps/web/components/copilot/CockpitView.tsx`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/components/studio/SlideEditor.tsx`, `apps/web/app/globals.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**:
  - **導覽收斂（nav.live 群組）**: AppShell NAV_GROUPS 與 HomeDashboard LIVE 卡由三個 external 連結（present/copilot/hud）收斂為兩個角色入口——簡報舞台→/present（帳號A）、會中副駕·HUD→/copilot（帳號B），移除頂層 hud 連結；labelKey 改 nav.present/nav.copilot；/hud 路由保留只降級（第二裝置用）。
  - **cockpit 外殼（CockpitView）**: header 加「私人帳號B、副駕＋HUD 同畫面」說明（copilot.cockpitAccountB）；<header> 與 grid 間加可收折 <details>「在另一台裝置看 HUD」affordance——creds 非空時顯示 buildHudUrl(creds) 唯讀連結＋複製鈕＋inline-SVG QR 佔位（無 QR 相依，複製連結為實際交接路徑），creds 為空顯示提示；單 <main>／雙欄 grid／雙 WS／CopilotInner·HudInner 掛載全未動。
  - **收音摩擦（CopilotView 中度）**: 起始卡內嵌同意勾選（copilot.consentInline，沿用既有 consentGranted state＝useState(false) 非預設勾）＋內嵌 TabShareTutorial 於 getDisplayMedia 前顯示分頁音訊三步引導＋ZeroTrackGuard 一鍵重試（onRetry=start）。相位機／CopilotInner export 介面不變；getDisplayMedia 仍在同一 user-activation 同步堆疊、前面不 await createMeeting（createMeeting 留在 SetupPanel）。
  - **帳號A 一鍵開簡報（SlideEditor）**: 工具列加「開始簡報」——靜態預覽（deckId-only /present）＋連線會議播放（先同步開空白分頁→createMeeting→buildPresentUrl(deckId,creds)→導向，帶 present-role token）；不動 present/page.tsx·PresentStage.tsx。
  - **helpers（meeting-session）**: buildPresentUrl(deckId,creds)→locale 前綴絕對 /present?deckId&meetingId&token(=wsToken)；buildHudUrl(creds)→locale 前綴絕對 /hud?meetingId&wsToken；currentLocale() 讀 pathname。i18n 兩語系 lockstep 加 25 鍵、移除 hud.title（保留 hud.desc）。
- **為什麼**: 使用者反映「會中進行三個介面太複雜」。/copilot 其實早已融合副駕＋HUD；本輪只收斂產品外殼（導覽＋收音引導＋帳號A launcher），不重建 pane、不動 server 契約。
- **不變量**: I3 靠 PresentStage import 白名單＋server 角色切流保證，非靠路由分開，收斂導覽不削弱；present 仍零-HUD 只 render deck_update。I1 未動 deck-patch／SuggestionQueue（append-tail）。I2 批准 gate 原封不動；inline consent 只 gate PCM→ASR，不 gate 頁面批准。launcher 鑄 present-role token（單一 wsToken、角色為連線期 query param）。
- **驗證**: apps/web `tsc --noEmit` exit 0 零診斷；fresh-context 走查（導覽兩入口無 hud/兩檔一致、affordance/雙WS、consent 非預設＋一鍵重試＋無 await createMeeting、launcher present URL、25 鍵兩語系齊全無殘留 removed key）PASS；不變量＋authz 攻擊者視角（誤帶/跨 org token 仍漏不出 HUD）PASS。未 commit（硬規則 10）。

### 2026-07-19 16:35 | code-review 修復：照片獵取拉丁短段誤中＋補查軟 deadline 早於硬逾時
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/research/photo-hunt.ts`, `apps/server/src/research/photo-hunt.test.ts`, `apps/server/src/research/orchestrator.ts`
- **改了什麼**:
  - **photo-hunt 拉丁短段子字串誤中（confirmed medium）**: `textHasName` 舊版一律 `t.includes(tok)` 子字串比對；羅馬拼音 2 字母段（Li/Wu/Yu/An/Xu/Su/Mo…）是 Quality/reliable/click/application 的子字串→`findPersonPhotoInHtml` 回第一張命中 alt 的 <img>，導致版面裝飾/導覽/廣告圖被誤指派為某主管頭像（confidence 0.5＋寫 provenance）。改為 **CJK token 走子字串、拉丁 token 走詞界 `\b…\b`**（`escapeRegExp` 轉義後動態建 RegExp，`i` flag）；`nameTokens` 的拉丁「切段」token 提高門檻至 ≥3 字（CJK 段維持 ≥2；整名 token 維持 ≥2 由詞界承載），雙重防線。新增 hasCjk（沿用 repo `/[㐀-鿿豈-﫿]/` 慣例）。Before: alt「Reliable application, click」含「li」→誤中；After: 僅 alt 含獨立詞「Li Wei」/「Wei」才命中真照片。加 2 條 regression 測（拉丁短段不誤中裝飾圖、純裝飾頁→undefined）。
  - **補查軟 deadline 形同虛設（confirmed medium）**: runDeep(:718)/runStandard(:579) 舊版 `runDeadlineAt = Date.now() + jobTimeoutMs()`，與外層 `withTimeout(work, jobTimeoutMs())`（:551）同值、且軟 deadline 在數個 await 後才算（t1>t0）→ 逐項前檢查 `Date.now()>deadlineAt` 永遠追不上硬 kill；長跑 job 直接 markFailed，增量落庫資料不被 reindex（reindexAfterJob 只在 markDone 後跑）。新增 `softDeadlineMs()`＝`jobTimeoutMs() - clamp(jobTimeoutMs()/6, 60s, 600s)`（預設 90 分→軟 80 分、留 10 分緩衝落庫/markDone/reindex）；兩處 runDeadlineAt 改用之。
- **為什麼**: 對抗式 code-review 兩筆 confirmed medium。純研究/落庫路徑，不動 deck patch/approval/HUD，不違反 I1/I2/I3。低嚴重度兩筆（contact-merge 同名合併資料遺失風險、meeting_signals.entity_ref_json 未 re-point）屬凍結契約既定設計/契約範圍外，此輪不修（見回報誤報說明）。
- **驗證**: `apps/server npx tsc --noEmit` 綠；`npx vitest run` 35 檔 179 測全綠（photo-hunt 由 5→7 測）。未動 web/crm；未 commit（硬規則 10）。

### 2026-07-19 15:45 | WS-B 引擎：more 模式全套＋deep 不丟官網 contacts＋dedupe＋照片獵取＋social 結構化落庫＋techStack noteZh＋記債四項
- **工作區**: apps/server（＋packages/shared 一行：CrawlMode 加 more，凍結契約「mode 集合 quick|detailed|deep|more」）
- **類型**: feat
- **檔案**: `packages/shared/src/crm-types.ts`(CrawlMode+more)；`apps/server/src/research/orchestrator.ts`, `routes.ts`, `deep-research.ts`, `extractor.ts`, `deep-extractor.ts`, `extract-shared.ts`, `crawler.ts`, `more-mode.ts`(新), `photo-hunt.ts`(新), `social/{types,youtube,threads,index}.ts`, `social.test.ts`；`apps/server/src/crm-routes/companies.ts`；`apps/server/src/research/{more-mode,clean-url,semaphore-settle,photo-hunt}.test.ts`(新)；`.env.example`
- **改了什麼**:
  - **more 模式全套**: routes MODES 加 `more`＋gemini 未設時 502；`CrawlMode` 加 `more`（shared）；orchestrator dispatch `mode∈{deep,more}`→runDeep。runDeep 變體(isMore)：(1) `buildMoreGapSeeds` 讀 DB 空欄（公司 scalar 欄/products 缺 pricing·specs·model/contacts 缺 background·photo/social 缺平台）→ `buildMoreGapQueries`（more-mode.ts 純函式，cap 12）當 follow-up round 種子（只發一次）；基礎角度縮為 overview+news（`baseAngleKeys`，deep-research.buildQueries 新增支援）、關社群模板。(2) 公司非受信任欄 fill-empty（既有非空從 mergedCompany 移除、其 provenance 也不寫）。(3) `decideEvidenceBoost`（純函式）：既有非空＋正規化相等＋新 sourceUrl 網域≠既有 provenance 網域＋非人工/已驗證→補一筆 supersede provenance（confidence=min(0.9,舊+0.15)、保留既有值、不動 verified）。(4) 完成後 dedupe＋照片獵取（與 deep 共用）。
  - **Task 1 deep 不丟官網 contacts**: runDeep `payload.contacts` 由 `[]` 改為 `siteExtract.contacts`（先 site 後 deep.people，靠 CONTACT_SPEC full_name_zh fallback＋mergeTitle 收斂）；落庫完成後（deep/more 皆）呼叫 WS-A 的 `dedupeCompanyContacts(core.db,...)`（best-effort，刪 stale 卡→runJob reindex 重建）。
  - **Task 2 照片獵取**: `photo-hunt.ts` 純函式 `findPersonPhotoInHtml`（<img> alt 含人名 token≥2 取 src；og:image 僅 title 含人名才收；過絕對 http(s)＋svg/ico＋追蹤像素）；enrichKeyPeople 內對仍無 photoUrl 者取 grounding citation 前 2 URL `crawler.fetchRaw` 解析、confidence 0.5＋provenance sourceUrl=該頁；目標篩選加「或缺 photoUrl」。
  - **Task 3 crawler CSS 背景圖**: 瀏覽器內 evaluate 補抓 inline style `backgroundImage`＋`<style>` 塊 `url(...)`（每頁≤10，w/h=0）concat 進 images，下游 `sanitizeCrawledImages` 同既有過濾。
  - **Task 5 social 結構化落庫**: `SocialFetcher.fetch` 回 `{sources,posts}`（youtube channel/video、threads profile→NewSocialPost，youtube metrics 存 views/subscribers/videoCount/likes/comments、publishedAt epoch）；orchestrator `core.companySocial.bulkUpsert`；`GET /api/crm/companies/:id/social`→`{links:(social_links JSON＋六個 social_* 單欄整併), posts}`（org-scoped，公司不存在→空）。
  - **Task 6 techStack noteZh**: extractor＋deep-extractor techStack schema/interface/mapper/SYSTEM prompt 各加 `noteZh`（一句 zh-TW，來源沒有就省略）。
  - **Task 7 記債四項**: (a) deep-research `createSemaphore`/`runWithSemaphoreTimeout` 匯出＋renderWithLimits 改「名額佔位到底層 fetchRaw settle 才釋放」（逾時仍回 null，release 掛 underlying settle 兩臂防死鎖）。(b) `enrichKeyPeople`/`enrichProductDetails` 收 `deadlineAt` 逐項前檢查、超時停剩餘＋log。(c) `cleanUrl` 移入 extract-shared 並「只接受絕對 http(s)」（extractor 改 import）。(d) `DEFAULT_BUDGET_MS`/`BUDGET_CEIL_MS` 1_200_000→3_600_000、orchestrator `jobTimeoutMs` 預設 3_600_000→5_400_000＋`.env.example` 同步（與 prod env 對齊）。
- **為什麼**: RESEARCH_UPGRADE v2 WS-B 引擎層（消費 WS-A 資料層）。沿用雙語不變量（主要欄留來源語言、*Zh gloss）＋provenance「值/來源同一 tx 不漂移」；純研究/落庫，不動 deck patch/approval/HUD，不違反 I1/I2/I3。
- **驗證**: `apps/server npx tsc --noEmit` 綠、`packages/{shared,crm}`＋`apps/web` tsc 綠；重建 packages/shared＋crm dist（vitest 走 dist；WS-A src 已改但 dist 舊→dedupe runtime 缺函式，rebuild 後消失）；`apps/server npx vitest run` 35 檔 177 測全綠（新增 more-mode 12／clean-url 4／semaphore-settle 4／photo-hunt 5＝25 測）。未 commit（硬規則 10）。

### 2026-07-19 15:05 | WS-A 資料層：migration 016（note_zh＋company_social_posts）＋social 型別/mappers/repo＋contacts fullNameZh fallback＋dedupeCompanyContacts
- **工作區**: packages/shared, packages/crm
- **類型**: feat
- **檔案**: `packages/crm/migrations/016_social_tech.sql`(新), `packages/crm/migrations-pg/016_social_tech.sql`(新), `packages/shared/src/crm-types.ts`, `packages/crm/src/mappers.ts`, `packages/crm/src/contact-merge.ts`(新), `packages/crm/src/child-upsert.ts`, `packages/crm/src/repos-prospect.ts`, `packages/crm/src/repos-social.ts`(新), `packages/crm/src/ports.ts`, `packages/crm/src/core.ts`, `packages/crm/src/index.ts`, `packages/crm/src/contact-merge.test.ts`(新)
- **改了什麼**:
  - **migration 016 雙套**: SQLite `company_tech ADD COLUMN note_zh TEXT`＋新表 `company_social_posts(id PK, org_id, company_id, platform, url, title, content, published_at, metrics_json, created_at, UNIQUE(org_id,company_id,platform,url))`＋org_company index；PG 版同義（`ADD COLUMN IF NOT EXISTS`、epoch 欄 BIGINT、`CREATE TABLE IF NOT EXISTS`）。
  - **crm-types**: `CompanyTech.noteZh?`；`Company.socialLinks?: CompanySocialLinks`（新介面：youtube/facebook/instagram/threads 具名可選＋index signature，映射 companies.social_links JSON）；`SocialPost`/`NewSocialPost`。ContactSummary 不動。
  - **mappers**: COMPANY_DEFS 加 `social_links`(J)；COMPANY_TECH_DEFS 加 `note_zh`；新 `SOCIAL_POST_DEFS`。
  - **contact-merge.ts（新）**: `mergeTitle(existing,incoming)`（[、·／/] 切段、trim＋收斂空白、大小寫不敏感去重、existing 先、「 · 」串接、上限 4 段）；`isEmptyVal`；`accumulateAndFillEmpty`（累加欄 mergeTitle＋fallback 命中時 fill-empty，就地調整 snake_case rec）；`dedupeCompanyContacts(db,orgId,companyId)`（按 trim 後非空 full_name_zh 分組≥2；survivor＝唯一 human-verified 否則 created_at 最舊；群內 ≥2 human-verified→console.warn 跳過；合併＝scalar fill-empty＋title/title_zh mergeTitle＋field_provenance 併入 survivor＋re-point company_product_people/contacts.reports_to/company_departments.head/deals.primary/economic_buyer/champion/deal_contacts(PK 撞先刪)/meeting_attendees/transcript.speaker/activities/training_sessions/notes(contact)＋刪 contact_card embeddings/profile_cards 讓 indexer 重建＋刪冗餘列；單群一交易）。
  - **child-upsert.ts**: ChildUpsertSpec 加 `fallbackMatchCols?`/`accumulateCols?`；`matchRow` 改 SELECT *；命中時 accumulate＋（fallback 時）fill-empty。CONTACT_SPEC 加 `fallbackMatchCols:["full_name_zh"]`、`accumulateCols:["title","title_zh"]`。
  - **repos-prospect.ts 深度路徑（SqliteContactRepository.upsertFromCrawl）**: full_name 精配落空且 incoming fullNameZh 非空→full_name_zh 再配一次（matchedByFallback）；命中→title/title_zh 累加＋fallback 時 fill-empty；**provenance 只寫實際落庫的欄**（fill-empty 略過者不寫，避免值/來源漂移）、title/title_zh 快照對齊合併後值。
  - **repos-social.ts（新）＋wiring**: `SqliteCompanySocialRepository`（`listByCompany` published_at DESC＋`bulkUpsert` 走 upsertChild matchCols[platform,url]）；ports.ts 加 `CompanySocialRepository` 介面＋CrmCore.companySocial；core.ts 組裝；index.ts 匯出 repo＋mergeTitle/isEmptyVal/dedupeCompanyContacts/DedupeResult。
- **為什麼**: RESEARCH_UPGRADE v2 social+tech 契約 WS-A 資料層：技術棧 zh 說明、社群貼文結構化落庫、雙語主管去重收斂（爬蟲重複/官網＋deep.people 收斂靠 full_name_zh fallback 鍵）。沿用雙語不變量（主要欄留來源語言、*Zh gloss）與 provenance「值與來源同一 tx 不漂移」；純 CRM 資料層，不動 deck patch/approval/HUD，不違反 I1/I2/I3。
- **驗證**: `npm run typecheck -w @meetcopilot/shared` 綠、`-w @meetcopilot/crm` 綠；`packages/crm` `npx vitest run` 8 檔 57 測全綠（含新 contact-merge.test.ts 8 測：mergeTitle／company-crawl fallback 命中+不命中／深度路徑 fallback+provenance 對齊／dedupe join re-point+deal_contacts PK 撞+provenance 併入+fill-empty／verified 保護跳過／survivor 最舊+唯一 verified）。未 commit（硬規則 10）。

### 2026-07-19 14:20 | WS-C web：Social tab 新元件＋TechTab 分類分組改版＋EnrichPanel「研究更多」(more)＋頭像 referrerPolicy＋i18n parity
- **工作區**: apps/web
- **類型**: feat
- **檔案**: `apps/web/lib/api.ts`, `apps/web/components/crm/SocialTab.tsx`(新), `apps/web/components/crm/CompanyDetailView.tsx`, `apps/web/components/crm/ChildTabs.tsx`, `apps/web/components/crm/EnrichPanel.tsx`, `apps/web/components/crm/ContactsTab.tsx`, `apps/web/components/crm/PersonaCard.tsx`, `apps/web/components/ui/JobProgressCard.tsx`, `apps/web/app/globals.css`, `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json`
- **改了什麼**:
  - **api.ts（型別鏡像＋getSocial getter）**: 新增 `EnrichMode = CrawlMode | "more"`（`more` 尚未進 shared CrawlMode，本地聯集鏡像避免 tsc 因 shared 未就緒而紅；shared 補上後仍相容）；`ResearchJob.mode` 與 `enrich()` 的 `mode` 由 `CrawlMode` 放寬為 `EnrichMode`。新增社群型別 `SocialPostMetrics`/`SocialPost`/`SocialLinks`/`CompanySocial` 與 `getSocial(id)` → `GET /api/crm/companies/:id/social` 回 `{links,posts}`（server 端點由另一工程師平行實作，按契約鏡像）。
  - **SocialTab.tsx（新元件）**: 帳號卡（links 物件非空值 → 依平台偏好排序的外開連結膠囊）＋每平台貼文分組（posts 按 platform 分組、組內 publishedAt 由新到舊）；每則貼文顯示 標題（url 外開）/日期(fmtDate)/觀看數(metrics.views, fmtNumber)/內文（標題≠內文才另列）。空態＝無 links 且無 posts。掛進 CompanyDetailView TabKey/TABS（「社群」置於「技術棧」後）＋ tabpanel render。
  - **ChildTabs.tsx TechTab（分類分組改版）**: 棄 `mc-techgrid` 擠壓卡片→新 `mc-techstack` 分類分組列表：`useMemo` 依 `category`（trim 空→「其他」）分組、分類名字母序；每列 名稱粗體（`mc-techstack__name`）＋`noteZh` 副行（`mc-techstack__note`）＋`ConfidenceBadge` 靠右＋`title` 屬性 tooltip 顯示「偵測來源：<detectedFrom>」。本地型別 `TechRow = CompanyTech & { noteZh?: string }`（shared 補 noteZh 前避免 tsc 紅）。
  - **EnrichPanel.tsx（第二動作 more＋STALE_MS）**: `STALE_MS` 65→95 分（deep 逾時 3.6M→5.4M ms，逃生口須大於伺服器逾時避免長跑誤判中斷）；新增 `MORE_MODE: EnrichMode = "more"` 與頂列「研究更多」ghost 按鈕（`mc-enrich__buttons` 包兩顆），`submit()` 重構為 `submit(mode: EnrichMode)`（deep 走面板、more 直接發起）；moreDesc tooltip。
  - **JobProgressCard.tsx**: `MODE_LABEL` 加 `more:"補充研究（補缺＋驗證）"`＋running hint 加 more 分支（否則落 deep/detailed 文案不精確）。
  - **頭像 referrerPolicy**: ContactsTab／PersonaCard 的 `<img>` 加 `referrerPolicy="no-referrer"`（避免熱連結被擋；既有無 photoUrl→initials fallback 保留不動）。
  - **globals.css**: 新增 `.mc-techstack*`（取代 dead `.mc-techgrid/.mc-techitem`）、`.mc-social__*`（帳號卡＋貼文）、`.mc-enrich__buttons`。
  - **messages 兩檔**: `enrichPanel` 加 `moreLabel`/`moreDesc`（en「Research more」/「Fill gaps and verify on top of existing data — faster.」；zh「研究更多」/「在既有資料上補缺＋驗證，較快。」），enrichPanel 與 top-level 鍵集 parity 驗證通過。
- **為什麼**: RESEARCH_UPGRADE / social+tech 契約 WS-C 前端實作：社群落庫可視化、技術棧改讀友善分組、研究單一入口外再提供較快的 more 補缺驗證路徑。沿用雙語不變量（主要欄留來源語言、*Zh gloss）與 provenance 慣例；純 CRM 展示＋研究觸發，不動 deck patch/approval/HUD，不違反 I1/I2/I3。server 端點與 shared 型別（socialLinks/CompanyTech.noteZh/CrawlMode more）由平行工程師實作，web 端以本地鏡像型別對接。
- **驗證**: `cd apps/web; npx tsc --noEmit` 綠（EXIT=0，連跑兩次穩定；期間 shared 被平行工程師編輯一度短暫紅於 crm-types.ts CompanySocialLinks，其settle 後即綠，非本工作區檔案）；en/zh-TW JSON parse OK＋enrichPanel/top-level 鍵 parity true。未 commit（硬規則 10）。

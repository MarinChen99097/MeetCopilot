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

- [`change_archives/archive_2026-07-30.md`](change_archives/archive_2026-07-30.md) — 涵蓋 2026-07-19 ~ 2026-07-30（43 筆、597 行）。主題：會中進行收斂＋補充頁 theme；Phase A1/A2/A3 對練升級（自助建對象、情境模式、對練語言）；WYSIWYG C1；Live 3.1 微調＋語速拉桿；登入純 Google＋admin 首次上線；**會中待講清單全鏈**（migration 023＋三包＋三輪 code-review 修正：slideIdx 座標系、evidence TTL 縱深、建會限流、uncheck 音訊時鐘冷卻、記帳歸屬）；「會中進行」兩入口改造（會議簡報/MeetCopilot、/present/start、舞台全螢幕）；/simplify 十項清理。
- [`change_archives/archive_2026-07-19.md`](change_archives/archive_2026-07-19.md) — 涵蓋 2026-07-07 ~ 2026-07-18（55 筆、602 行）。主題：M0 地基→M5 完成→GCP Cloud Run 部署上線；CRM 核心＋研究引擎擴編（爬蟲深廣多輪、社群來源、雙語 *Zh gloss、per-contact 背景抽取 MAX_TOKENS 韌性、deep/more 模式）；DynamicSlide／會中副駕／模擬訓練三產品線；admin 平台後台＋記帳＋停權；UI 換皮＋可收折側欄 Shell＋首頁儀表板；Postgres 移植；多輪 code-review／simplify 修復。2026-07-19（含）起之新紀錄留於本檔。

---

<!-- TRACKER_BELOW -->

### 2026-07-30 16:55 | C2 對抗驗證修正——三態負結果標記（§11.1 v1.4）＋匯入端點掛共用限流桶（§11.5 v1.4）
- **工作區**: apps/server｜packages/crm
- **類型**: fix
- **檔案**: `apps/server/src/import/text-extract.ts`, `apps/server/src/index.ts`, `apps/server/src/import/text-extract.test.ts`, `apps/server/src/generation/deck-outline.test.ts`, `apps/server/src/ops/rate-limit-wiring.test.ts`, `packages/crm/src/repos-decks.ts`（doc comment）, `packages/crm/test/deck-text-extract.test.ts`
- **改了什麼**: (1) 三態語意：讀圖 fallback 回空字串——Before `if (text.length===0) continue;`（留 NULL）→ After **寫入 `''` 負結果標記**（回應缺 text 欄位＝失敗，仍留 NULL 可重試）；`needsText` Before `(s.textExtract ?? "").trim().length>0` → After `typeof s.textExtract === "string"`（NULL/undefined＝未抽過→需要；`''`＝確認無字→跳過；非空→跳過）。(2) `index.ts` 限流名單加 `app.post("/api/decks/import", jwtGuard, limit)`（共用桶、body parser／multer 之前）。(3) 測試：server +5（讀圖回空→DB 落 ''、第二輪 not-needed＋gemini 零呼叫；25 頁全空第一輪寫 '' 前 20、第二輪自動輪到 21–25；缺 text 欄位留 NULL；`''` 頁不進 outline；wiring 名單斷言含 import＋extract-text 且在 parser 之前）；crm +1（`''` 經 rowToSlide `?? undefined` 讀回仍是 `''`）；假 core 的 setSlideTextExtract 改有狀態（寫入反映 slides）供第二輪測試。repos-decks doc comment 明文「`''` 合法值、不得加空字串守衛」。
- **為什麼**: C2 對抗驗證確認兩條契約漏洞（契約更正 v1.4）：a) 「空字串一律不寫」讓讀圖確認無字的頁永遠 NULL → 每次回填重燒讀圖永不收斂（實測 5 頁純圖 deck 每輪 5 呼叫）、且 `slice(0,maxPages)` 每輪同批＝第 21 頁起永久飢餓；b) 匯入本身就是 LLM 觸發端點（每發最多 20 次讀圖）且 in-flight 去重以 deckId 為鍵、每次匯入＝新 deck 去重永不命中，不掛桶＝合法帳號可連打匯入無限燒讀圖。驗收：crm tsc 重建 EXIT=0＋vitest 88/88（基準 87）；server `tsc --noEmit` EXIT=0＋vitest 61 檔 375/375（基準 370）。

### 2026-07-30 18:55 | C2 匯入抽字——測試（8 項契約要求）＋pdf.js Buffer byteOffset 修正
- **工作區**: packages/crm｜apps/server
- **類型**: feat（測試）＋fix
- **檔案**: `packages/crm/test/deck-text-extract.test.ts`（新）, `apps/server/src/import/text-extract.test.ts`（新）, `apps/server/src/import/pdf-parser.ts`
- **改了什麼**: (1) crm 測試 7 條：setSlideTextExtract 對 original 頁／committed 頁**照寫成功**（證明繞開 OriginalSlideLocked/I1 是刻意且有效）、spec_json 逐位元不動、org 隔離零副作用不 throw；getPageImage 命中/未命中/跨 org null/kind 過濾。(2) server 測試 15 條：parsePptxText 重排 zip fixture（檔名序≠sldIdLst 序→跟 sldIdLst 走；缺 sldIdLst/缺 rel→null）、assemblePdfPages 單頁失敗佔位＋手工構造真實 2 頁 PDF 整條 parsePdfText、數量守門（2≠3→零寫入）、讀圖上限（25→20 呼叫、頁 20–24 NULL）、fill-empty 冪等＋native/已全有字/processing→not-needed＋併發第二發 in-flight no-op、抽字 throw→deck ready+job done＋時序（ready 之後 done 之前）、計費（kind=gemini_extract、orgId/userId、idemKey seq 唯一）。(3) fix：`parsePdfText` 把輸入轉 `new Uint8Array(buffer)` 精確拷貝——pdf.js v1.10 對非 0 byteOffset 的 pooled Buffer 視圖會誤用底層 ArrayBuffer 全段（實測 'bad XRef entry'）。
- **為什麼**: 契約 §11 測試最低要求 8 項；Buffer byteOffset 陷阱在測試中真實踩到（Buffer.from(string) 走 pool），prod 路徑（worker Buffer.from(ArrayBuffer) 恰為 0-offset）僥倖不觸發，防禦性修正。

### 2026-07-30 18:35 | C2 匯入抽字——回填端點＋限流名單＋前端觸發
- **工作區**: apps/server｜apps/web
- **類型**: feat
- **檔案**: `apps/server/src/decks-routes/index.ts`, `apps/server/src/index.ts`, `apps/web/lib/api.ts`, `apps/web/components/copilot/CopilotView.tsx`
- **改了什麼**: (1) 新端點 `POST /decks/:id/extract-text`：org-scoped（findById 守門→404）；`maybeStartTextExtract` 判斷——native deck／已全有字／匯入未完成→`200 {needed:false}`，需要跑／同 deck in-flight→`202 {started:true}`（fire-and-forget，無 job 列、前端不輪詢）。(2) `index.ts` 限流名單（body parser 之前、共用單一 TokenBucketRateLimiter）加 `app.post("/api/decks/:id/extract-text", jwtGuard, limit)`。(3) web `requestDeckTextExtract(deckId)` client 函式。(4) `CopilotView` 建會表單：選中 deck 的 effect fire-and-forget 打一次（與 draft-objective 同時機；零 UI 狀態、失敗靜默）。
- **為什麼**: MEETING_CHECKLIST_CONTRACT §11.5：C1 之前匯入的 deck text_extract 全 NULL，需靜默回填；守低門檻＝零新按鈕，唯一觸發點在選 deck 時；限流掛共用桶避免同 org 額度加倍與白 parse body。

### 2026-07-30 18:25 | C2 匯入抽字——server 管線（輕量解析器＋讀圖 fallback＋掛進 conversion-job）
- **工作區**: apps/server
- **類型**: feat
- **檔案**: `apps/server/src/import/pptx-parser.ts`, `apps/server/src/import/pdf-parser.ts`, `apps/server/src/import/run-in-worker.ts`, `apps/server/src/import/parse-worker.ts`, `apps/server/src/import/text-extract.ts`（新）, `apps/server/src/import/conversion-job.ts`, `apps/server/src/decks-routes/import-handler.ts`
- **改了什麼**: (1) `parsePptxText`：逐頁純文字（只回 string[]），頁序權威＝presentation.xml `sldIdLst`（經 _rels 映 rId→slideN.xml）——解不出/缺 rel/缺檔一律回 null（對齊無效訊號）；單頁 XML 壞掉以空字串佔位。(2) `parsePdfText`＋`assemblePdfPages`：pagerender 以 `pageData.pageIndex` 為鍵收集，單頁失敗（pdf-parse `.catch(()=>"")` 靜默吞頁）補空字串佔位不位移；索引不可得時退順序收集＋數量守門。(3) worker task 新增 `pptx-text`/`pdf-text`。(4) 新 `text-extract.ts` 管線：fill-empty 冪等（text_extract 空且 spec 文字空的原始頁）、數量守門（解析頁數≠originalCount→整份丟棄）、每頁 trim+8000 上限、讀圖 fallback（<TEXT_EXTRACT_MIN_CHARS(20) 觸發；TEXT_EXTRACT_VISION_MAX_PAGES(20)/TEXT_EXTRACT_VISION_CONCURRENCY(2) env 化；attempts=1、temperature=0、thinkingBudget=0）、meteredGeminiClient kind='gemini_extract'、module-level in-flight Set 併發去重、worker 傳 `Buffer.from(bytes)` 複本防 detach。(5) conversion-job：`ConversionDeps.extractText?` 可選階段，於 setImportStatus('ready') 之後、setJobStatus('done') 之前跑，自帶 try/catch 只 log；`runConversionJob` 改收 `Partial<ConversionDeps>` 合併預設。(6) import-handler：`_config/_meter` 啟用，工廠期建 gemini client，注入 extractText（userId＝匯入者、idemPrefix=`textextract:${jobId}`）。
- **為什麼**: MEETING_CHECKLIST_CONTRACT §11（v1.3 凍結）：匯入 deck 逐頁餵料 checklist；既有 parsePptx 檔名序＝錯的權威（重排過的 pptx 文字靜默錯位→翻頁勾稽誤劃），pdf 順序 push 有吞頁位移風險；任何失敗不得影響匯入本身。

### 2026-07-30 18:05 | C2 匯入抽字——crm repo 層（setSlideTextExtract＋getPageImage）
- **工作區**: packages/crm
- **類型**: feat
- **檔案**: `packages/crm/src/ports.ts`, `packages/crm/src/repos-decks.ts`, `packages/crm/src/repos-deck-assets.ts`
- **改了什麼**: DeckRepository 新增 `setSlideTextExtract(orgId, deckId, idx, text)`——獨立 UPDATE 只寫 `deck_slides.text_extract`、不碰 spec_json、不 bump decks.updated_at、**刻意不走 updateSlide**（原始頁必命中 OriginalSlideLocked/I1 守門，而 text_extract 非內容變更）；orgId 進 WHERE（跨 org 命中 0 列）。DeckAssetRepository 新增 `getPageImage(orgId, deckId, pageIndex)`（kind='page_image' 單頁 PNG bytes，讀圖 fallback 用）。兩處介面均掛 doc comment「僅限匯入期與回填 job，嚴禁 realtime／會中路徑」。
- **為什麼**: MEETING_CHECKLIST_CONTRACT §11.4／§11.5：匯入 deck 逐頁純文字落庫供 checklist 取材；回填讀圖需依 deckId+pageIndex 取頁圖（DB 欄與 idx_deck_assets_deck_kind 索引已在，缺 repo 方法）。

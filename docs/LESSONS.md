# 踩雷教訓（Lessons）

> ⚠️ v2 對齊註記：本檔教訓來自 v1 實戰，**教訓本身仍有效**；但範例中的操作語彙（INSERT_AFTER、插入主題最相關段落、anchor 頁風格繼承）已被 v2 append-only 模型取代（見 00-DECISIONS 決策 13）——語彙以 PRODUCT_SPEC v2 為準。範例中引用的檔案路徑/章節屬 v1 repo 結構，v2 對應位置以 CLAUDE.md 路由表為準。模型調度以 MODEL_DISPATCH 覆寫節為準。

> 格式與追加規則見 `MAINTENANCE.md` 第二節。一條一則，追加到檔尾。

## L1 PowerShell 5.1 的 `&&` 與寫檔編碼（2026-07-04）
- 情境：在此 Windows 環境跑 shell 命令、寫檔案。
- 踩了什麼：`cmd1 && cmd2` 直接解析錯誤；`Out-File` 預設 UTF-16 導致其他工具讀到亂碼（本次為預防性記錄，非實踩）。
- 正確做法：鏈式命令用 `cmd1; if ($?) { cmd2 }` 或改用 Bash 工具；寫檔一律用 Write/Edit 工具。
- 影響檔案：`DIAGNOSIS.md` 第 3 名（完整替換表）。

## L2 本目錄不是 git repo，改壞無法回滾（2026-07-04）
- 情境：建立制度檔時盤點環境。
- 踩了什麼：（預防性）任何覆蓋性修改都沒有版本保護。
- 正確做法：改既有檔前複製 `檔名.bak`；並持續向使用者建議 `git init`。
- 影響檔案：專案根目錄的 `CLAUDE.md`（注意：在根目錄，不在 docs/ 下）硬規則 4。
- **【已解決 2026-07-04】** git init 已完成，本專案現為 git repo。**現行規則以 git 為主要備份、不需 `.bak`**（見 CLAUDE.md 硬規則 4／MAINTENANCE 通用規則／DIAGNOSIS 次要浪費節）——本條 `.bak` 做法僅適用於「非 git 目錄」的歷史情境。

## L3 模型型號與參數不可憑記憶填（2026-07-04）
- 情境：撰寫 MODEL_DISPATCH.md 時。
- 踩了什麼：（預防性）訓練記憶中的型號/參數常已過時（例：budget_tokens 已在新模型移除）。
- 正確做法：session 內調度看 Agent/Workflow 工具 schema 的實際枚舉值；產品程式碼的 API model ID 一律先載入 `claude-api` skill 再寫。
- 影響檔案：`MODEL_DISPATCH.md` 開頭查證方法。

## L4 引用規格範例碼前，先審它的原始用途（2026-07-04）
- 情境：撰寫 ARCHITECTURE_PLAN v1 時，把規格書的 share-guard 範例碼直接當成「對方聲音擷取」的落地程式碼。
- 踩了什麼：該段碼是防漏餡守門碼——不含 `audio:true`（照抄會拿到零音軌，功能直接失靈），且是封鎖清單（只擋 monitor、放行 window）。對抗審查抓出後才修正。
- 正確做法：複用任何範例碼前先問「它原本為什麼而寫」；擷取碼必須顯式 `audio:true` 並驗 `getAudioTracks().length>0`；安全檢查一律寫允許清單不寫封鎖清單。
- 影響檔案：`ARCHITECTURE_PLAN.md` §1（修正版程式碼）；原規格 HTML 是否修訂待使用者決定。

> 以下 L5–L11 是「實際用這套制度蓋完 MeetCopilot」後的實戰教訓（2026-07-04 同日），非規劃期推測，證據力最高。

## L5 平行實作 agent 會各自對「假設的契約」實作而漂移（client/server 邊界）（2026-07-04）
- 情境：派 6 個 agent 平行實作 server 與 web；型別契約在 packages/shared，但 REST 層（路徑、請求/回應欄位、錯誤碼）沒有共用真相來源。
- 踩了什麼：前端對「它假設的 API」寫、後端對「另一套假設」寫 → register 漏 orgName、generateDeck 欄位全錯、importDeck 路由不符、session.id vs sessionId、listDecks envelope、error body 形狀全對不上，web↔server 端到端完全跑不通。code-review 抓到 6 個 critical 契約不一致。
- 正確做法：跨 client/server 邊界平行派工**前**，先把「線上契約」（不只型別，連路徑、請求/回應形狀、錯誤碼）凍結成共用檔或一份契約文件，兩邊都 import／對照；交辦 prompt 明文「不得自創路徑/欄位，缺什麼回報 gaps」。整合後**必做真實 client→server 整合冒煙**（見 L6）。
- 影響檔案：`TASK_TEMPLATES.md` T2、`MODEL_DISPATCH.md` 第三節（平行派工守則）。

## L6 只測一邊 ≠ 整合驗證過（2026-07-04）
- 情境：實作完成後我對 server REST/WS 直接冒煙，全綠就當作可以了。
- 踩了什麼：server 自己測全過，但前端根本呼叫不到（契約不符，L5）——因為冒煙只打 server，沒走「前端 lib/api 實際發出的請求形狀」。整批 critical 契約 bug 因此漏掉。
- 正確做法：宣稱「完成」時必須驗證真正的整合路徑——用「前端實際的請求形狀」打 server 的端到端冒煙，不是各元件孤立測。
- 影響檔案：`JUDGMENT_RUBRICS.md` R2、`TASK_TEMPLATES.md` T2。

## L7 安全不變量要用「攻擊者的憑證」測，不是 happy-path 本人（2026-07-04）
- 情境：驗證 presenter 授權（只有 presenter 能改 deck / 動 consent / 翻頁）。
- 踩了什麼：我的冒煙用 presenter 本人 token，怎麼測都過，完全沒暴露「同 org 的其他成員可劫持別人會議」這個 critical 授權繞過——是 code-review 才抓到。
- 正確做法：測權限/隔離不變量，一律用「不該有權的那個身分」的真實憑證去打（另一個 user、另一個 org、非 presenter 角色），確認被拒。happy-path 本人測試對授權漏洞是盲的。高風險安全判斷一律加對抗審查。
- 影響檔案：`TASK_TEMPLATES.md` T5、`JUDGMENT_RUBRICS.md` R5。

## L8「npm ls 有、spawn 卻 ENOENT」＝疑防毒攔截，別重裝硬拚（2026-07-04）
- 情境：electron-builder 打包一直失敗，`app-builder.exe` spawn ENOENT；`npm ls` 顯示 app-builder-bin 在依賴樹，但檔案不在磁碟。
- 踩了什麼：反覆 npm install／降版／清 lock 重裝共四次都沒解——根因是 Windows Defender 靜默把 app-builder.exe 當可疑執行檔隔離，不是安裝壞了。
- 正確做法：當「套件 npm ls 存在但其原生 .exe spawn ENOENT／檔案不在磁碟」，優先懷疑防毒隔離，別一直重裝。改走「用已存在的二進位」的路徑（本例改 @electron/packager，用 electron 自帶 binary 產可攜資料夾，繞過 app-builder.exe）。
- 影響檔案：`DIAGNOSIS.md` 次要陷阱。

## L9 令人警覺的訊號，先讀「地面真相」再動手（2026-07-04）
- 情境：本 session 兩次——(a) PowerShell 行數顯示制度檔像被截斷（LESSONS 顯示 6 行、WORKLOG 11 行）；(b) app-builder ENOENT 像安裝失敗。
- 踩了什麼：(a) 差點以為檔案毀損要重建，實際是 `Measure-Object -Line` 對 LF 行尾檔數錯，Read 一看檔案完好；(b) 見 L8。
- 正確做法：任何「像是已知災難」的警訊，先用權威來源核對地面真相（用 Read 讀實際檔案內容／查實際錯誤根因），確認後再動狀態。pattern-match 到熟悉的失敗，不代表成因相同。
- 影響檔案：`JUDGMENT_RUBRICS.md` R7（新增）。

## L10 設計/品味錯誤由使用者發現，不是測試——誠實條款的實例（2026-07-04）
- 情境：會中生成新頁的「插入位置＋風格參考」。我實作成「插在正在播的那頁之後、用那頁當參考」。
- 踩了什麼：這在 typecheck／冒煙／對抗審查全過（程式正確），但**設計是錯的**——使用者指出應插到「主題最相關的段落」（例如第 15 頁）並用那頁當參考。拆解＋驗證＋評審都補不了這種設計判斷。
- 正確做法：對「怎麼做才對」屬於品味/設計的決策（非對錯），早點把方案攤給使用者選，別默默拍板還藏起不確定（誠實條款）。可驗證的執行品質才交給 subagent＋審查；設計取捨要升級或問人。
- 影響檔案：`JUDGMENT_RUBRICS.md` R6（已有原則，本條為實例）。
- （v2 註：插入位置已改為一律 append 到尾端〔決策 13〕，本條的「設計錯誤要由使用者拍板」教訓仍成立，插入位置的具體行為以 v2 為準。）

## L12 Windows 平行 npm install → 套件半解壓損毀（2026-07-07）
- 情境：M0/M1 工作流多個 agent 在同一 `node_modules` 上並行跑 `npm install`。
- 踩了什麼：套件被寫到一半（症狀＝`.d.ts` 在、`.js` 不見，如 google-auth-library 缺 20 檔、caniuse-lite 缺 24 檔），且**單純重跑 `npm install` 修不好**（它不修「已存在但不完整」的套件）→ server 開不了、`next build` 掛。疑防毒/檔案鎖介入解壓。
- 正確做法：(1) 派工守則已有「同機平行 agent 勿同時 `npm install`」——由**單一 Verify agent 統一裝一次**；(2) 一旦出現「半解壓」症狀，**`rm -rf node_modules && npm install` 全清重裝**，別做針對性修補（B4 針對性修補只是繞過、根因還在）。
- 影響檔案：`DIAGNOSIS.md`（次要浪費節可加一條）、`MODEL_DISPATCH.md` 平行派工守則（已有勿並行 install，補「清裝優先於修補」）。

## L13 Playwright 在此機 `browser.close()` 懸掛 → 背景 job 卡死（2026-07-07）
- 情境：M1 研究引擎的 Playwright 爬蟲，`finally { await browser.close() }`。
- 踩了什麼：`browser.close()` 在此 Windows 機**永不 resolve**（>8s，root cause＝優雅關閉/子進程終止，疑防毒），連帶 `crawl()` 的 finally 卡住 → enrich 的 crawl_job 永遠停在 `running`。程式**沒有逾時/強殺兜底**就繼承了這個懸掛。
- 正確做法：任何外部子進程（Playwright/瀏覽器/未來的 ffmpeg 等）的關閉都要 **race 一個 deadline＋強殺 fallback**（`Promise.race([close(), timeout]); process()?.kill('SIGKILL')`）；長任務 job 要有**整體 deadline**，且失敗一律落 `status='failed'`（絕不留 `running`）。這是「外部進程不可信、一定要能被我方逾時掐斷」的通則。
- 影響檔案：`apps/server/src/research/crawler.ts`（已修）、`DIAGNOSIS.md`。

## L14 絕不自動覆寫使用者的 .env 祕鑰檔（2026-07-07，實踩・毀資料）
- 情境：使用者的 GEMINI/OPENAI key 一度填在根 `.env`，但 server 讀 `apps/server/.env`。我寫了「把 root 非空值同步到 server」的腳本救急。
- 踩了什麼：使用者之後**直接改 `apps/server/.env`** 填入新的 OpenAI key（255 字元），但根 `.env` 沒動（仍是舊的 54 字元）。我再跑一次同步腳本→**用舊的 root 值蓋掉使用者剛填的新值**，而 `.env` gitignored 無版控→**新 key 永久遺失**，只能請使用者重填。
- 正確做法：(1) `.env` 祕鑰檔**唯一真相＝server 實際讀的那個檔**（本專案＝`apps/server/.env`）；(2) **永不自動 sync/覆寫祕鑰檔**——要 key 就請使用者直接編輯該檔，我只做「遮蔽後的格式/長度/前綴檢查」，絕不寫值；(3) 需要多檔一致時，改讓程式載入單一來源（dotenv 指定路徑），不要用腳本搬祕鑰。
- 影響檔案：（行為守則）任何 session 處理 .env 一律唯讀檢查；`apps/server/.env` 為 key 的唯一落點。

## L15 flash-lite 對「複雜結構化抽取」不穩，抽取任務要升 3.5-flash（2026-07-08，實踩）
- 情境：研究引擎爬頁文字→Gemini 結構化抽取成 CRM 欄位（union-superset schema）。
- 踩了什麼：`gemini-3.1-flash-lite` 三種壞法——(1) 在某欄位吐雜引號（smart quote / 逸出 `\"`）使 JSON 結構**坍縮**，但**仍是合法 JSON** 故不觸發重試，後續欄位靜默掉光（症狀＝只填出 name＋半殘 websiteUrl、還帶尾逗號）；(2) 拿掉該欄位後陷入 **283KB unterminated string 的 runaway**，同樣重試磨數分鐘；(3) 偷懶把描述塞錯欄位。爬文字本身沒問題（抓到 4513 字）、prompt 也沒問題——是**模型能力**。
- 正確做法：(1) 較複雜的結構化抽取用 `gemini-3.5-flash`（`GEMINI_EXTRACT_MODEL`），一般文字/生成維持 flash-lite——**分模型、按任務難度配**；(2) 結構化輸出一律設 `maxOutputTokens` 上限讓 runaway **fail-fast**（別無上限磨到逾時）；(3) `required` 標關鍵欄位逼模型填，別全 optional（optional 會被偷懶跳過）；(4) parse 前 `stripJsonFences`。
- 影響檔案：`apps/server/src/{config,gemini,research/extractor}.ts`（已改）、`.env.example`、`API_FINDINGS §E`。與 v1 空白頁 bug（schema 定太鬆）互補：那次是 schema 問題、這次是模型問題，兩者都在「結構化輸出」這條路上。

## L16 安全修正必須對「已證明可用的路徑」做回歸驗證（2026-07-08，實踩）
- 情境：/code-review 抓到 Playwright 爬蟲 SSRF DNS-rebinding，修法用 `--host-resolver-rules` pin IP＋`MAP * ~NOTFOUND` fail-close 其餘 host。
- 踩了什麼：fail-close 看似最安全，但**弄壞了近乎通用的 www↔apex 跨 host 重導**——`www.ghost.org` 302 到 apex `ghost.org`（不同 host），fail-close 讓 Chromium 解不到 apex→整個導航死。CyberPower 剛好單 host 沒中招，所以若只測「原本那個成功案例」會漏掉這個回歸。
- 正確做法：(1) **安全修正後，一定要對「先前證明可用的功能」重跑**，而且**多測一個不同形狀的案例**（單 host vs www→apex），否則會把「安全修正」偷渡成「功能回歸」；(2) SSRF 於瀏覽器爬蟲的正解＝**只 pin 使用者提交的目標 host**（關主要 TOCTOU），其餘公網子資源 host 放行但由 per-request 守衛擋私網——不要 fail-close 全部 host（過度限制、破壞跨 host 重導與 CDN 子資源）。
- 影響檔案：`apps/server/src/research/crawler.ts`（改回 pin-only）、`crawler-ssrf.test.ts`。與指揮官守則呼應：宣稱修好前派 fresh agent 對「會被弄壞的既有功能」重驗，不只驗「修的那個點」。

## L17 對抗式驗收要涵蓋「帶參數的端點」，別只測 happy-path 空參數（2026-07-09，實踩）
- 情境：admin 後台交付後我派 fresh-context 對抗驗收，12/12 CONFIRMED-OK；但隔一步的 `/code-review`（5 鏡頭）立刻抓到一個 Critical：admin `/usage`、`/jobs`、明細抽屜首次載入就 400——前端 DateRangePicker 送 `YYYY-MM-DD`、後端 parseEpoch 要 epoch-ms（`Number("2026-06-10")=NaN`→400）。
- 踩了什麼：驗收的 admin 端點測試（含 admin.test.ts）都**省略了 from/to 參數**，只打空參數的 happy path→200，於是「核心報表頁全打不開」這個 P0 完全漏網。typecheck 也綠（兩邊都 typed，只是 string≠epoch 語意不符）。前後端契約有寫「epoch-ms」，但沒有測試強制對齊。
- 正確做法：(1) 驗收「有查詢參數的端點」時，**必用前端實際會送的參數形狀**打一次（用 UI 預設值，不是空值/整潔值）；能起前端就實跑該頁看是否真的載入，不能就至少用「前端 default range 產生器的輸出」餵 API。(2) 跨前後端的參數格式（日期/分頁/枚舉）列為「契約對齊」測試點，型別相同不代表語意相同。(3) 這也印證：自建對抗驗收 ≠ 免跑 code-review；兩者鏡頭不同，都要跑。
- 影響檔案：`apps/admin/src/lib/api.ts`（dayParamToEpochMs 集中轉換）、`api-types.ts`（UsageSummary.from/to 改 number）。與 L6「只測一邊≠整合驗證」同源，補「參數形狀」維度。

## L18 email allowlist 授權旗標絕不能在「未驗證 email 擁有權」的路徑蓋（2026-07-09，實踩）
- 情境：admin 平台管理員＝`PLATFORM_ADMIN_EMAILS` allowlist；實作把「email∈allowlist→蓋 platformAdmin:true」的 `payloadFor` 同時用在 login／google／**register** 三處。
- 踩了什麼：register 是公開自助且**不驗證 email 擁有權**。若 admin 是 Google-only（本地無該帳號），攻擊者搶先 POST register 用該 allowlist email→拿到帶 platformAdmin 的 JWT→全 /api/admin/* 洞開（A1 繞過）。login（要密碼）、google（驗證 email）安全，唯獨 register 漏。
- 正確做法：授權旗標只在「證明 email 擁有權」的路徑蓋（login 需密碼、google 驗證 email）；**任何自助/未驗證註冊路徑一律不衍生特權旗標**。register 改直發 `role:"owner"` 不走 admin 衍生。連帶：測試若「直接拿 register token 當 admin token」＝把洞當正常用法，要改成「register 後 login」取得。
- **補完（2026-07-09 /simplify altitude 鏡頭揪出）**：只讓 register「不發旗標」**不完整**——攻擊者仍可自助 register allowlist email（設自己密碼）→再 login，login 照樣發 platformAdmin。**治本＝從源頭擋帳號建立：register 直接拒絕 allowlist 內的 email（403 reserved）**，合法管理員走 Google（經 provision 不經 register）或 out-of-band 建帳號。通則：**「排除特權」要排在所有發證路徑的最上游（帳號建立），不是只排某一條發證路徑**——否則攻擊者換另一條路徑照樣拿到。
- 影響檔案：`apps/server/src/auth/routes.ts`（register 不走 payloadFor＋拒絕 allowlist email）、`register-admin.test.ts`。與硬規則 7（授權用攻擊者憑證測）同源。

## L19 修 bug 時「新寫的測試」也會把錯誤前提固化成回歸鎖定（2026-07-28，實踩）
- 情境：checklist 的 `evidence` 欄會落庫逐字稿片段，但 TTL purge 不涵蓋新表。我升級修這條，修法＝purge 加一條 `WHERE covered_by = 'transcript'`，並要求 agent 補測試。
- 踩了什麼：**修法本身有繞過路徑，而新測試正好在保護那個洞。** `setStatus('covered', by)` 會改 `covered_by` 但**不動 `evidence`**；snapshot 廣播有 300ms debounce，這段時間 HUD 上該項仍顯示 pending，報告者點 checkbox → `covered_by` 由 `'transcript'` 變 `'manual'`、evidence 留著 → 永不符 purge 的 WHERE → 逐字稿永久留存。而新增的 `transcript-retention.test.ts:81` 斷言「manual 的 evidence 不會被清成 NULL」——**它假設 manual 的 evidence 恆為 NULL（錯的前提），於是把洞寫成回歸鎖定**。測試全綠、回歸驗證 agent 也 pass，只有**被明確指示「預設立場＝修正有漏、主動去找漏洞」的對抗路 agent** 抓到（還寫 probe 腳本實跑，輸出 `!!! TRANSCRIPT TEXT SURVIVED TTL !!!`）。
- 正確做法：
  1. **修 bug 時新增的測試，本身要被對抗驗證**——問「這條斷言的前提是什麼？有沒有路徑能讓前提不成立？」測試綠不代表洞補好，可能只代表洞被鎖進契約。
  2. **「必須清乾淨」的資料（隱私/保留）用排除法，不用列舉法**：白名單式條件（只清 X）只要有任何路徑把狀態改成 X 以外的值就漏出範圍；改成「預設清、只排除明確安全的」（本例＝只排除 `'slide'` 的「第 N 頁」）。同時**源頭一併堵**（狀態轉換時清掉舊來源的證據），縱深兩層。
  3. **驗證要分兩路且角色明確**：回歸路（確認改了、測試綠、無退步）與對抗路（假設有漏、主動攻擊、預設立場是誤報/有洞）抓到的東西**完全不同**。單跑回歸路會漏。這是 L7「用攻擊者憑證測」在**驗證流程**層面的推廣。
- 影響檔案：`apps/server/src/realtime/transcript-retention.ts`＋其測試、`packages/crm/src/repos-checklist.ts`（`setStatus` 轉換時清 evidence）。與 L16（安全修正要回歸驗證）、L17（自建驗收≠免跑 code-review）同源：三條都是「驗證的鏡頭不對，就看不到問題」。

## L20 跨鏡頭交叉命中的 finding，比單一鏡頭的高分更值得信（2026-07-28）
- 情境：`/code-review` 五鏡頭平行審 checklist 三包＋兩入口改造，8 個 finding 各派對抗式反駁者評分，門檻 ≥80 才 confirmed。結果 confirmed 1／killed 7。
- 踩了什麼：（方法論，非程式踩雷）**最重要的那個 bug 差點被門檻機制淡化**。`checklist-gen.ts` 的 slideIdx 座標系 bug 被**五個鏡頭中的四個獨立抓到**，四個 verifier 全部 `refuted:false`，但分數是 80／76／73／70——**只有一個過門檻**。若只讀 confirmed 清單，會誤判成「單一鏡頭發現、勉強過關」而輕忽它。另一條真問題（evidence 的 retention 缺口）拿 58 分被 killed，卻是 verifier 自己寫「值得補一條 SQL」的——**它是從 killed 清單撈上來的**，而後續對抗復驗證明它牽出更深的洞（見 L19）。
- 正確做法：
  1. 讀審查結果時**必看 killed 清單裡 `refuted:false` 的項目**——那代表「驗證過是真問題，只是影響半徑被評為邊際」，不是誤報。真正的誤報是 `refuted:true` 或分數落在 0–49 帶。
  2. **同一位置被多個獨立鏡頭命中＝強訊號**，優先度應高於單一鏡頭的分數。分數衡量的是「影響半徑」，交叉命中衡量的是「存在性的確定度」，兩者不可互換。
  3. 門檻（≥80）是**降噪工具，不是裁決依據**。指揮官要對 50–79 帶逐條裁決「修 vs 記債」，判準是**修法成本 vs 留債後果**（本例：一條 SQL vs 「哪天開放 opt-in 就靜默違反保留政策」→ 修）。
- 影響檔案：`.claude/skills/code-review/SKILL.md`（可補「裁決時必讀 killed 中 refuted:false」一節）、`JUDGMENT_RUBRICS.md`。

## L21 別把 agent 的「觀察」外推成「因果結論」寫進制度紀錄（2026-07-28，實踩・我自己犯）
- 情境：review agent 正確觀察到「`checklistGenDeps()` 回傳未包 meter 的 raw gemini client」，我據此裁決要修，並在 ROM／CHANGE_TRACKER 寫下理由：「這條路徑的 token **完全不進** `usage_events`、costUsd 少計、無法歸屬 org」。
- 踩了什麼：**外推錯了。** 019 的安全網早就接住了這條路徑——`meterBoundary` 中間件用 `runWithMetering` 包住整個 handler，而 raw 的公開 `generateJson` 內部**無條件** `safetyNetRecord`，orgId／userId 都正確落帳，既有測試 `metering-safety-net.test.ts:51-58` 就在鎖這條。agent 看到的是「raw client」（**真**），我寫下的是「零記帳」（**假**）。修正本身仍有價值（explicit 優於 fallback），但**嚴重性被高估、成因被寫錯**。後果不是程式壞掉，而是**制度紀錄污染**：未來 session 讀 ROM 會以為「這條路徑曾有一段成本黑洞」而去回填／對帳歷史 usage_events，或以為安全網不管用而重造輪子。
- 正確做法：
  1. **制度紀錄裡把「觀察到的事實」與「推導出的後果」分開寫**，並且只有查證過的後果才寫成斷言。沒查證的寫成待驗假設（「疑似…待確認」），不要寫成既成事實。
  2. **有安全網／兜底機制的系統，「某處漏包」不等於「該處無效果」**——下結論前先問「有沒有更外層的機制接住它？」本專案的 metering 就有兩層（explicit wrapper ＋ `meterBoundary` 安全網），SSRF 也有兩層（DNS-pin ＋ per-request 私網守衛）。
  3. **同一輪的復驗 agent 要被明確要求查核「制度紀錄的敘述是否與程式相符」**——本條就是記帳復驗 agent 主動抓出來的（它的任務裡有「逐跳追」，順手發現我的敘述與 8 跳實況不符）。這個鏡頭很便宜、很值得常設。
- 影響檔案：`docs/ROM.md` 2026-07-28 22:35 決策 2（已加事實更正段）、`docs/CHANGE_TRACKER.md` 同輪理由 B。與 L9「先讀地面真相再動手」同源，但這條是**寫紀錄時**的版本：pattern-match 到「漏包→沒記帳」很順，但地面真相多一層。

## L11【正面校準】指揮官不下場＋sonnet/high 實測有效（2026-07-04）
- 情境：全程「主對話只交辦＋收結論，實作/修正/簡化/審查全派 sonnet subagent」蓋完整個 app。
- 踩了什麼：非踩雷，是校準。原 MODEL_DISPATCH 調度表標「未實測、信心中低」。
- 正確做法：本 session 實測約 14 個 sonnet subagent（6 實作＋2 修正＋2 簡化＋審查群）在 high effort 下勝任全端實作/重構/審查，主對話 context 保持乾淨。故 MODEL_DISPATCH 調度表的 sonnet 列可視為「已實測可行」，實作/重構/研究/審查交 sonnet/high 是驗證過的預設；難題除錯與設計取捨仍留主線或升 opus。
- 影響檔案：`MODEL_DISPATCH.md` 第三節（移除「未實測」caveat）。

## L22 Gemini responseSchema 的 `min/maxItems` 有「文法展開預算」，超過就整份 400（2026-08-01，實踩）
- 情境：deck 生成瘦身，想用 schema 上界治 MAX_TOKENS 退化迴圈——給每個陣列 `maxItems`、把頁數綁進 `slides.minItems=maxItems=pages`。
- 踩了什麼：**16/16 次呼叫全 `400 INVALID_ARGUMENT`**，訊息只有 `"Request contains an invalid argument."`，**不指出是哪個欄位、也不說是 schema 的問題**。單獨探測時 `maxItems`／`minItems`／`maxLength`／`propertyOrdering` **每一個都被接受**（用小 schema 測全 OK），所以「逐特性探測」第一輪完全誤導——問題不在特性本身，在**組合的總量**。
- 正確做法：
  1. Gemini 會把每個 `min/maxItems` **展開成文法重複**，展開量 ≈ Σ(maxItems × 該子 schema 文法大小)，有預算上限。本專案實測（`gemini-3.5-flash`，`BLOCK_SCHEMA` 20 個 property 的聯集超集）：**通過** `blocks.maxItems≤4`、`slides.maxItems≤2`、葉層 7 個小陣列（features/items/steps/headers/rows/cells/tracks）同時加、全欄 `maxLength`、全層 `propertyOrdering`；**400** `blocks.maxItems="8"`、`slides` 綁頁數（連 2 都敗）、葉層再多加 `ticks`／`series`／`left`／`right` 任一組。
  2. **`maxLength` 不吃這份預算**（有無 maxLength 都不改變 `blocks.maxItems` 的成敗）→ 想壓縮輸出長度，優先用 `maxLength` 而不是 `maxItems`。
  3. **除錯法**：不要用小 schema 逐特性測（會全綠），要拿**真實 schema 逐項剝除**（strip 一個 key 重打）＋**逐項加回**兩個方向夾擊。腳本樣板留在 scratchpad `schema-bisect{,2,3,4,5}.mts`。
  4. **上線守門**：任何 responseSchema 改動都要先用真 API 打一次四個呼叫點（`schema-accept.mts`），否則 400 只會在 prod 出現（unit test 用 stub client，永遠測不到）。
- 影響檔案：`apps/server/src/generation/slide-gen.ts`（檔內已寫 `GRAMMAR BUDGET` 註解區塊，改 schema 前必讀）、`docs/research/API_FINDINGS.md`（可補一節）。

## L23 Windows 上 vitest 會因磁碟機代號大小寫把同一檔求值兩次 → `instanceof` 判偽、prototype spy 靜默不觸發（2026-08-19，實踩）
- 情境：stereo 雙聲道實作期間，agent 發現 `npm test` **約 50% 機率**倒在 `checklist.test.ts` 的 6 個 uncheck 冷卻測試上（`TypeError: emit is not a function`），`packages/crm` 也間歇噴 `to be an instance of I1ViolationError / LastOwnerError`。兩處看似無關，**根因同一個**。
- 踩了什麼：Windows 上 vitest/vite 偶爾把**同一份檔案**以不同磁碟機代號大小寫解析（同一份 log 內同時出現 `c:\…` 與 `C:\…`），於是同一個模組被求值**兩次**，產生兩份互不相等的 class 物件與 prototype。後果有兩種面貌：
  1. 測試檔 import 到的 class ≠ 產線 `new` 出來的 class → **`instanceof` 判偽**；
  2. 測試在 A 份 prototype 上裝 spy，產線跑的是 B 份 → **spy 靜默不觸發**，斷言拿不到呼叫紀錄而失敗。
  最惡劣的是它**間歇**——一半機率是綠的，極易被歸類成「flaky，重跑就好」而長期忽略，持續侵蝕對測試結果的信任。**這不是產線 bug**，產線碼從頭到尾正確。
- 正確做法：
  1. **需要攔截產線物件的方法或回呼時，一律從 live 實例取，不要從 import 進來的 prototype 取**。本次修法：`checklist.test.ts` 改成 attach 之後讀 `runtime.engine.signalsCb`；新測試用 `livePrototype()`／`finalCbOf()` helper 從實例反查。
  2. **斷言錯誤類型改用不依賴模組身分的判別**（`err.name` 而非 `instanceof`）。嚴格度不可放寬——要驗到的類型仍要驗到，只是換一種判別方式。
  3. **診斷法**：間歇失敗且訊息是「X is not a function」或「to be an instance of Y」時，先懷疑模組重複求值，而不是先懷疑產線邏輯。驗證方式是在 log 裡搜同一路徑的大小寫變體。
  4. **連跑五次才算綠**：單次通過完全不能證明間歇問題已消除。本專案的 `npm test` 驗收自此以連跑計。
  5. 反向風險要記著：本例的表現是「該過的測試失敗」（偽陽性，只消耗信任）。但同一根因**理論上也能讓該失敗的測試通過**（例如 spy 沒觸發卻只斷言「沒被呼叫」），那才是真正危險的方向——設計斷言時避免僅依賴「未被呼叫」。
- 影響檔案：`apps/server/src/realtime/checklist.test.ts`、`apps/server/src/realtime/stereo-audio.test.ts`、`packages/crm/test/invites-repo.test.ts`、`docs/DIAGNOSIS.md`（環境陷阱可補一條）。

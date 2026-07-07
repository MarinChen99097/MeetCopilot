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

## L11【正面校準】指揮官不下場＋sonnet/high 實測有效（2026-07-04）
- 情境：全程「主對話只交辦＋收結論，實作/修正/簡化/審查全派 sonnet subagent」蓋完整個 app。
- 踩了什麼：非踩雷，是校準。原 MODEL_DISPATCH 調度表標「未實測、信心中低」。
- 正確做法：本 session 實測約 14 個 sonnet subagent（6 實作＋2 修正＋2 簡化＋審查群）在 high effort 下勝任全端實作/重構/審查，主對話 context 保持乾淨。故 MODEL_DISPATCH 調度表的 sonnet 列可視為「已實測可行」，實作/重構/研究/審查交 sonnet/high 是驗證過的預設；難題除錯與設計取捨仍留主線或升 opus。
- 影響檔案：`MODEL_DISPATCH.md` 第三節（移除「未實測」caveat）。

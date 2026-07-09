---
name: code-review
description: "自動化多 agent 對抗式程式碼審查（v2 自含，不依賴 CodeRabbit）。當使用者要求 review 程式碼／PR、檢查品質、找 bug、部署前把關，或完成一個功能後說『完成了』『done』『寫好了』『幫我看一下』時使用。關鍵詞：code review, 代碼審查, 程式碼審查, review PR, 審查, 檢查程式碼, find bugs, 找 bug, audit, 驗證, /code-review, 這段 code 有問題嗎, 有沒有 bug, push 前檢查。針對『當前 git 變更』做本地審查（v2 目前無 GitHub remote）。"
---

# Code Review — 自動化多 Agent 對抗式審查（v2）

同時啟動多個 **`model:"opus"`** 審查 agent 並行審查「當前變更」，用信心分數（≥80）過濾誤報，只輸出真正有問題的項目。**完全自含——不需 CodeRabbit／外部 CLI**，只用 `git`（有 GitHub remote 時才用 `gh`）。

> 參考 ezpagesite 的 `/code-review`（本地模式）改寫。模型分工照 v2 硬規則 1／`docs/MODEL_DISPATCH.md`（審查一律 opus，非 ezpage 的 Haiku/Sonnet）。同名的 slash 指令在 `.claude/commands/code-review.md`（顯式 `/code-review` 用它）；本技能供「說『完成了/幫我看一下』時」自動觸發。

## 觸發時機
- 使用者要求 review 程式碼或 PR、部署前把關、push 前最後檢查。
- 完成一個功能後要求品質確認（「完成了」「done」「寫好了」）。
- 發現可疑 bug 需要深入分析。

## 審查範圍（依情境）
- **預設（本地）**：工作區未 commit 變更 `git diff HEAD`（**含未追蹤新檔，逐一讀全文**）。
- 指定 base：`git diff <ref>..HEAD`（跨這次 session 全部 commit 用開工前 sha）。
- 有 GitHub PR：`gh pr diff <N>`（v2 目前無 remote，通常走本地）。

## 方法
1. `git diff --stat` 抓改動檔清單，做 TODO 清單。
2. **平行 5 個 opus agent**，每個一種視角，只看 diff＋必要脈絡（建議用 **Workflow 工具** 寫成 pipeline：reviewer→verify→彙整）：
   1. **Bug／正確性** — 真 bug、crash、未處理 reject/throw、race、資源洩漏（timer/worker/stream）、邊界。
   2. **產品不變量** — **I1**（deck 只 append 尾端／pending REORDER，不動已播頁）、**I2**（新頁進 live deck 前經 approval gate）、**I3**（HUD/副駕不外流到被分享畫面）、**SSRF**（extract/crawler IP-pin/私網阻擋）。任一削弱＝critical。
   3. **authz（攻擊者視角）** — 授權路徑用「非 presenter／跨 org 憑證」想像是否被正確拒絕（硬規則 7）。
   4. **錯誤處理／邊界** — 空／超大／惡意輸入、錯誤映射（HTTP status、不外洩 raw upstream）、逾時／取消／背壓。
   5. **脈絡一致性** — `git blame`/`log`＋相關檔案既有註解/約定，改動是否違反。
3. **信心評分（只留 ≥80）**：每個 finding 另派 opus agent 對抗式驗證，0–100——0＝誤報/既有問題；50＝真但邊際；80+＝高信心、實際會踩、或**直接違反 I1/I2/I3/SSRF**。<80 濾掉。
4. **忽略**：typecheck/compiler/lint 可抓的；既有（非本次改動）問題；未改到的行；nitpick；明顯刻意/與主改動相關的行為變更；程式內註解明確靜音的。**不自己跑 build/typecheck**（CI 另跑）。

## 本專案重點檢查（對照 CLAUDE.md / docs）
- **三大不變量 I1/I2/I3** 未被削弱（改造引擎只有 APPEND＋pending REORDER；approval gate；HUD 零外流）。
- **SSRF**：`import/extract.ts`、`research/crawler.ts` 的 IP-pin／私網＋雲端 metadata 阻擋、逐跳重驗未回退。
- **金鑰安全**：無硬編碼 API key／secret／token（用 env／Secret Manager）。
- **CHANGE_TRACKER**：改了程式檔有對應 `docs/CHANGE_TRACKER.md` 紀錄（硬規則 8）；決策有 `docs/ROM.md`（硬規則 9）。
- **部署安全**（若含部署改動）：`gcloud run services update --image` 保留 env（勿 `--set-env-vars`/完整 `run deploy` 吹光 DB/CORS/Google）；改 `apps/web` 才需重建 web（`NEXT_PUBLIC_*` build-time）。見 `docs/DEPLOY.md`。

## 輸出格式（繁體中文、依嚴重度分組）
```
## Code Review 結果（範圍：<diff base>）

### 🔴 Critical（安全／資料遺失／crash／破不變量）
- `檔案:行` — 一句失敗情境（真實輸入/狀態→錯誤結果）。修法：<最小修法>

### 🟡 Warning（bug／效能／反模式）
- `檔案:行` — …

### ⚪ Info（小問題）
- `檔案:行` — …

### ✅ 無高信心問題 —（某類無發現就這樣寫）
```
每項必附 `檔案:行`。找到問題開 TODO 追。

## 界線
- **不自行 commit／部署**（CLAUDE.md 硬規則 6／使用者偏好）——審查只回報；使用者要「修」再修，修完同流程復審。

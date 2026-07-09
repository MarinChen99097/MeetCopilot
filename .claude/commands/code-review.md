---
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git blame:*), Bash(git rev-parse:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr comment:*)
description: 多 agent 本地對抗式程式碼審查（v2 自含，不依賴 CodeRabbit）
disable-model-invocation: false
---

對「當前變更」做多 agent 對抗式程式碼審查。**完全自含——不需 CodeRabbit／任何外部 CLI**，只用 `git`（v2 無 GitHub remote，預設走本地模式；有 remote 時才用 `gh`）。
> 為什麼要有這個檔：沒有它時，`/code-review` 會解析到「未安裝的 CodeRabbit plugin」而失敗。此指令參考 ezpagesite 的 `/code-review`（本地模式），改用 v2 的模型分工與不變量。

## 1. 決定審查範圍（依參數）
- **無參數** → 審工作區未 commit 變更：`git diff HEAD`（**含未追蹤新檔，逐一讀全文**）。
- `--base <ref>` 或 `<sha>` → 審 `git diff <ref>..HEAD`（跨這次 session 所有 commit 用開工前的 sha）。
- 給 PR 編號且 repo 有 GitHub remote → `gh pr diff <N>`。

## 2. 方法（照做）
1. 先 `git diff --stat` 抓改動檔清單，做 TODO 清單。
2. **平行派 5 個 `model:"opus"` 審查 agent**（v2 硬規則 1／docs/MODEL_DISPATCH：搜尋/審查一律 opus），每個一種視角，只看 diff＋必要脈絡（可用 **Workflow 工具**寫成 pipeline：reviewer→verify→彙整，更省事）：
   - **a. Bug／正確性**：changed code 的真 bug、crash、未處理 reject/throw、race、資源洩漏（timer/worker/stream）、off-by-one/邊界。
   - **b. 產品不變量**：**I1**（deck 只 append 到尾端／pending REORDER，不動已播頁）、**I2**（新頁進 live deck 前經 approval gate）、**I3**（HUD/副駕不外流到被分享畫面）、**SSRF**（extract/crawler 的 IP-pin/私網阻擋）——改動是否削弱。任一削弱＝critical。
   - **c. authz（攻擊者視角）**：授權路徑用「非 presenter／跨 org 憑證」想像是否被正確拒絕（v2 硬規則 7）。
   - **d. 錯誤處理／邊界**：空／超大／惡意輸入、錯誤映射（HTTP status、不外洩 raw upstream）、逾時／取消／背壓。
   - **e. 脈絡一致性**：`git blame`/`log` 與相關檔案既有註解/約定，改動是否違反。
3. **信心評分（只留 ≥80）**：對每個 finding 另派 opus agent 對抗式驗證，0–100 評分——0＝誤報或既有問題；50＝真但邊際/罕見；80+＝高信心、實際會踩、或**直接違反 I1/I2/I3/SSRF**。<80 濾掉。
4. **忽略**（誤報清單）：typecheck/compiler/lint 可抓的（型別、import、格式）；既有（非本次改動）問題；未改到的行；senior 不會挑的 nitpick；明顯刻意/與主改動相關的行為變更；被程式內註解明確靜音的。**不自己跑 build/typecheck**（CI 另跑）。
5. **輸出（繁體中文，依嚴重度分組）**：
   ```
   ## Code Review 結果（範圍：<diff base>）
   ### 🔴 Critical（安全／資料遺失／crash／破不變量）
   - `檔案:行` — 一句失敗情境（真實輸入/狀態→錯誤結果）。修法：<最小修法>
   ### 🟡 Warning（bug／效能／反模式）
   - ...
   ### ⚪ Info（小問題）
   - ...
   ### ✅ 無高信心問題 —（若某類無發現就這樣寫）
   ```
   每項必附 `檔案:行`。找到問題就開 TODO 追。
6. **不自行 commit／部署**（CLAUDE.md 硬規則 6；規則已寫入使用者偏好）——審查只回報。若使用者要「修」，修完再依同流程復審。

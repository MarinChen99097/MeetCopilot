# 快速診斷：此 harness 的三大失效模式與修法

> 目的：讓每個 session（不論模型大小）避開這個環境最貴的三種浪費。
> 讀者：Sonnet 等級模型。每條都是「照做即可」的規則，不是建議。
> 撰於 2026-07-04，由 Fable 5 session 根據實際環境盤點寫成。

---

## 第 1 名（漏 token）：主對話直接大量讀檔、掃目錄、貼長輸出

主對話的 context 是最貴的資源。每讀進一個大檔，之後**每一輪**對話都要重複付這些 token 的錢。

**具體修法（照做）：**

符合以下任一條件，就必須派 subagent（用 Agent 工具，`model: "haiku"` 或 `"sonnet"`），不准自己讀：

- 需要讀 **3 個以上**的檔案才能回答
- 單一檔案超過 **300 行**，且你只需要其中的結論而非逐行編輯
- 不確定目標在哪個檔案（需要搜尋、探索）→ 用 `Explore` subagent
- 要驗證「某件事做完了沒」→ 派 fresh-context agent 去看（見 MODEL_DISPATCH.md「驗證不自驗」）

主對話**允許**直接讀的只有兩種：(a) 你即將用 Edit 修改的檔案的目標區段；(b) 1–2 個小檔（各 <300 行）且立刻要用——與上方「3 個以上才必須派工」的門檻一致。（另外：CLAUDE.md 與 docs/ 制度檔屬「規則載入」，不受本節限制。）

subagent 的回報必須遵守回報合約（見 MODEL_DISPATCH.md）：只回結論 + `檔案:行號`，長產物存檔後回傳路徑。**禁止**把整個檔案內容貼回主對話。

**反例（禁止）**：為了確認「改造引擎的 guard 寫在哪」，自己連續 Read 五個檔案找。
**正例**：派一個 Explore agent：「找出 applyPatch/guard 邏輯位置，回傳 檔案:行號 與 10 行內摘要」。

---

## 第 2 名（易失焦）：長 session 被壓縮或中斷後，任務狀態蒸發

context 壓縮隨時可能發生。沒存檔的進度、腦中的計畫、「等一下再改」的待辦，壓縮後全部消失，弱模型會憑殘缺摘要重建錯誤的任務理解。

**具體修法（照做）：**

1. **每完成一項就立刻存檔**，再開始下一項。存檔的就是全部，沒存的等於沒做。
2. 超過 3 步的任務，開工前先用 TodoWrite 建清單，每完成一步就更新。
3. 跨 session 的工作狀態寫入 `docs/WORKLOG.md`（格式見 MAINTENANCE.md），包含：做到哪、下一步是什麼、有什麼坑。
4. **禁止**在回覆裡承諾「稍後會做 X」然後繼續別的事——要嘛現在做，要嘛寫進 TodoWrite/WORKLOG。

**反例（禁止）**：一口氣改五個檔案，最後才一起儲存。
**正例**：改完第一個檔案 → Write 存檔 → 更新 todo → 才動第二個。

---

## 第 3 名（易出錯）：Windows PowerShell 5.1 語法陷阱

此環境的 shell 是 Windows PowerShell 5.1（也有 Bash 工具走 Git Bash）。用 Unix 或 PowerShell 7 的直覺寫命令會直接報錯或產生壞檔案。

**具體修法（替換表，照抄）：**

| 你想寫的 | 會發生什麼 | 改成這樣 |
|---|---|---|
| `cmd1 && cmd2` | PowerShell 5.1 解析錯誤 | `cmd1; if ($?) { cmd2 }`，或改用 Bash 工具 |
| `Out-File` / `Set-Content` 寫檔 | 預設 UTF-16 編碼，其他工具讀出亂碼 | **一律用 Write/Edit 工具寫檔，不用 shell 寫檔** |
| `native.exe 2>&1` | 5.1 會把 stderr 包成錯誤、`$?` 變 false | 不要重導 stderr，harness 已自動擷取 |
| `head` / `tail` / `touch` / `which` | 不存在 | `Select-Object -First N` / `-Last N`；其餘見 PowerShell 工具說明 |
| `mkdir -p` | `-p` 不是參數 | `New-Item -ItemType Directory -Force <path>`（但 Write 工具會自動建父目錄，通常不需要） |

**通則**：檔案的讀、寫、改、搜尋一律用專用工具（Read / Write / Edit / Glob / Grep），shell 只拿來跑 git、npm、建置、測試。

---

## 附註：次要但常見的浪費

- **MCP 工具面板肥大**：此環境有 200+ 延遲載入工具。不要用 ToolSearch 載入與當前任務無關的 schema。本專案常用的只有：`chrome-devtools`（測試前端頁面）、`context7`（查函式庫文件）。有多個 MCP server 未授權（Notion、Canva、Linear 等）——**不要嘗試替使用者 OAuth**，直接告知使用者去授權即可。
- **版本控制已就緒**：本專案已是 git repo（2026-07-04 git init 完成，是主要備份來源）。改既有檔用 commit/diff 回滾即可，不需要 `.bak`（追加型日誌檔 WORKLOG/LESSONS 更不需要，見 MAINTENANCE.md）。改動前確認 `git status` 乾淨；階段性成果隨手 commit。
- **依賴的原生二進位「npm ls 有、spawn 卻 ENOENT」＝疑防毒攔截**（L8 慘痛教訓）：Windows Defender 會靜默隔離某些工具的 .exe（本專案是 electron-builder 的 `app-builder.exe`）。徵兆＝`npm ls X` 顯示在依賴樹，但該套件的 .exe 不在磁碟、spawn 報 ENOENT。**別一直 npm install/降版/清 lock 重裝**（重裝解不了防毒隔離）——改走「用已存在的二進位」的路徑（本例改 `@electron/packager`，用 electron 自帶 binary 產可攜資料夾）。

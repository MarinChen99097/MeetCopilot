---
name: scenario-verification
description: "Concrete scenario-based code verification for MeetCopilot. Triggers automatically when: (1) Claude finishes writing or modifying code, (2) user asks to verify/check/review code. Performs 4 mandatory checks: data flow tracing with real values, user accessibility path check, multi-scenario boundary testing, fix-effectiveness confirmation. Never abstract — always trace actual values through actual code. When the change touches deck patch / CRM / research jobs, also trace the I1/I2/I3 invariants (only pending pages editable, approval gate, HUD never leaks). Keywords: 驗證, 檢查, verify, check, review, 測試, 確認, 程式寫完, 你確定, 能夠套進去嗎, does it work, 有沒有問題, 確定可以嗎"
---

# Scenario Verification（MeetCopilot）

每次完成程式碼修改、或被要求驗證時，**必須執行以下 4 個步驟，缺一不可**。

核心原則：**代入真實數值逐行追蹤，禁止停在「邏輯上應該正確」的層次。**

> MeetCopilot 專屬提醒：凡改動觸及 deck patch、approval gate、HUD／分享畫面、CRM 授權隔離、研究 job，Step 1/Step 4 必須把 **I1（只改 `index > committedIndex` 的 pending 頁）／I2（patch 進 live deck 前經 approval gate）／I3（HUD 不得出現在被分享畫面）** 當成資料流的一環追蹤——用「攻擊者視角」代入不該有權的身分／越權的 op（非 append 的 op、REORDER 觸及 committed 區段、跨 org token），確認被 reject。此 skill 與內建 `verify`（動態跑真流程）互補：本 skill 靜態逐行追蹤，`verify` 動態驗行為。

---

## Step 1 — 資料流追蹤

從呼叫入口到最終輸出，代入具體數值，逐層追蹤。

**追蹤的層次（視實作內容選擇相關層）：**

- **輸入層**：使用者輸入 / API Request body / 函數參數 — 帶入真實值
- **驗證層**：型別轉換、Schema 驗證、Guard clause — 這一層會不會擋住？
- **邏輯層**：條件分支、計算、狀態修改 — 每個 `if/else` 走哪條路？
- **副作用層**：DB 寫入、快取、外部 API 呼叫 — 值是什麼？有沒有真的執行？
- **輸出層**：回傳值、UI 渲染、事件觸發 — 最終使用者 / 呼叫方看到的是什麼？

**格式（必須具體，不能模糊）：**
```
→ 入口：func(x=42, y="hello")
→ 驗證：x > 0 → True，繼續
→ 分支：if y is not None → 走 True 分支
→ 計算：result = x * 2 = 84
→ 儲存：db.save({ result: 84 }) ✓
→ 回傳：{ status: "ok", value: 84 } ✓
```

**常見陷阱（主動檢查）：**
- 型別隱式轉換（`int` vs `float`、`string` vs `int`）
- 預設值被後面的邏輯覆蓋
- 同一個變數在不同層有不同的命名
- 條件式只測試了 True 分支，沒測試 False 分支
- 資料在跨層傳遞時被序列化/反序列化遺失欄位

---

## Step 2 — 可達性檢查

使用者能否真正到達這個功能？從入口到功能點，逐關卡確認。

**每個關卡都要明確確認（✓ 通過 / ✗ 阻擋）：**

| 關卡 | 檢查內容 |
|------|---------|
| 認證/授權 | 是否需要登入？角色/權限（presenter vs 一般成員、org 隔離）是否符合？Token 是否會過期？ |
| 路由/導航 | URL 路徑是否正確？有無 redirect、rewrite、locale 轉址攔截？ |
| 前端渲染條件 | UI 元素是否在正確條件下顯示？有無 `hidden`、`disabled`、approval gate 未通過？ |
| API 接口一致性 | 前端呼叫的 endpoint/method/payload 與後端定義完全一致？（client/server 契約漂移是整批 bug 的來源） |
| 資料依賴 | 功能是否依賴前一個 API 成功？有無 loading/error 狀態擋住後續操作？研究 job 是否已完成？ |
| 環境差異 | 這個功能在**本機 SQLite（dev）**與 **Cloud SQL / Cloud Run（prod）**行為是否一致？有無環境專屬設定（`DB_DRIVER`、`NEXT_PUBLIC_*` build 期常數）？ |

---

## Step 3 — 情境矩陣（邊界測試）

**自行產生至少 5 組情境，覆蓋以下類型：**

| 類型 | 說明 | 目的 |
|------|------|------|
| 正常路徑 | 最標準的使用情境，所有輸入合法 | 確認基本功能正確 |
| 已存在 / 重複操作 | 對象已存在，或同一操作執行兩次 | 確認冪等性，不破壞現有資料 |
| 最小邊界 | 0、空字串、空陣列、null、undefined | 不崩潰，有合理 fallback |
| 最大邊界 | 極大數字、超長字串、大型陣列 | 不崩潰，有上限或截斷 |
| 非預期型別 | 小數輸入整數欄位、字串輸入數字欄位 | 型別驗證是否正確 |
| 缺少可選欄位 | 部分欄位省略或為 null | fallback 到預設值，不報錯 |
| 並發 / 競態 | 兩個操作同時執行 | 確認不會產生資料不一致 |
| 越權 / 攻擊（涉及 deck/授權時必加） | 非 presenter 改 deck、改 committed 頁、跨 org token | 必須被 reject（I1/I2、授權隔離） |

對**每一組情境**，都要執行 Step 1 的資料流追蹤（至少追蹤關鍵層）。

---

## Step 4 — 修復有效性確認

**這個修改真的解決了原始問題嗎？有沒有引入新問題？**

**Before vs After 對比（必須具體）：**

```
問題描述：[一句話說明原始問題]

Before（修復前）:
  → 代入問題情境的數值
  → 在第 N 行發生錯誤：[具體錯誤]

After（修復後）:
  → 代入相同數值
  → 現在的結果：[具體正確結果] ✓
```

**Side Effect Check（必須做，逐項展開）：**

修改了一個邏輯，確認它不會破壞其他使用同一段程式碼的情境：
- 列出有哪些其他呼叫路徑也會走到這個修改
- 對每個路徑，確認行為仍然正確

**Write-Reader 交叉驗證（必須做）：**

對每一個新增/修改的「寫入」操作，執行完整交叉驗證：

| 檢查項目 | 具體做法 |
|---------|---------|
| 所有讀取者 | Grep 這個 key/variable，找出所有讀取它的位置（前端、server、生成/研究管線）。對每個讀取者確認：讀取的格式（型別、singular/plural、string/list）與寫入一致 |
| 同一 key 的其他寫入者 | 在同一函數或同一資料流中，是否有其他地方也寫入同一個 key？如果有，確認不會互相覆蓋、或 string+list TypeError |
| 下游消費者重複讀取 | 如果把資料寫入了位置 A 和位置 B，確認下游不會從 A 和 B 各讀一次導致 double-loading |
| Skip/Filter 邏輯粒度 | 如果修改了 skip 條件（跳過某些 key/頁/欄位），確認 skip 的粒度正確 — 例如 deck 的 **pending 頁**與 **committed 頁**（I1）本就有不同的可改規則，不能用一個 set 籠統跳過；CRM 的 contact 與 account 欄位、研究 job 的 auto 與 manual 觸發同理 |

**Fallback 路徑專項檢查（新增 fallback 時必須做）：**

| 檢查項目 | 具體做法 |
|---------|---------|
| Fallback 觸發條件 | 確認 fallback 在正常路徑（非 fallback 情境）中**不觸發**，代入正常值追蹤 |
| Fallback 來源是否已被消費 | 如果 fallback 從來源 A 收集資料寫入 field B，確認來源 A 不會被下游另一條路徑再次讀取（例如 transcript 片段同時被分析層與 deck 生成層各讀一次、研究 job 的來源段落被回填兩次），否則同一筆資料會被處理兩次 |
| Fallback 寫入目標的型別 | 確認寫入目標在其他路徑中的型別（string vs list vs dict），不能在同一個 key 有時寫 string 有時寫 list |

---

## 輸出格式

```
## 驗證結果

### Step 1 — 資料流
[具體追蹤，帶真實數值]

### Step 2 — 可達性
[每個關卡：✓ 通過 / ✗ 發現問題]

### Step 3 — 情境矩陣
情境 1（正常路徑）：...
情境 2（重複操作）：...
情境 3（最小邊界）：...
情境 4（最大邊界）：...
情境 5（型別邊界）：...
情境 6（越權攻擊，涉及 deck/授權時）：...
[視情況增加]

### Step 4 — 修復有效性
Before：...
After：...
Side Effect Check：...

### 結論
✅ 全部通過
或
❌ 發現問題：[列出具體問題與建議修法]
```

---

## 禁止事項

- 說「邏輯上應該正確」而不帶入數值追蹤
- 說「build 通過就代表功能正確」（build 只驗型別）
- 跳過邊界測試，只測正常路徑
- Side Effect Check 說「應該不影響其他地方」而不實際確認
- 在沒有讀過相關程式碼的情況下做驗證
- 寫入一個 key 後不 Grep 所有讀取者就宣告完成
- 用一個 skip set 同時跳過多個寫入目標（例如 deck 的 pending 與 committed），而不確認原始碼對每個目標是否有不同的規則
- 把資料從來源 A 搬到 field B 時，不檢查來源 A 是否已被下游 pipeline 的 field list 消費
- 涉及授權/deck 的改動，只用本人 happy-path token 測就宣告通過（對越權漏洞是盲的）——必須用攻擊者視角驗 I1/I2/I3

---

> 來源：改編自 ezpagesite `.claude/skills/scenario-verification/SKILL.md`（原檔專案無關）；本檔已將範例情境改為 MeetCopilot（deck patch / CRM / 研究 job）並掛上 I1/I2/I3 不變量。

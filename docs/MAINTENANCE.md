# 維護協議：這套制度檔怎麼改、誰能改

> 讀者：未來每個 session 的主對話模型。

## 一、修改許可權

| 檔案 | 弱模型可自行修改？ | 規則 |
|---|---|---|
| `docs/WORKLOG.md` | ✅ 隨時 | 每次 session 結束前必更新 |
| `docs/LESSONS.md` | ✅ 只准**追加**與**歸檔/刪減**（見第三節） | 不准改寫別人的教訓內容；精簡若涉及「把教訓升格為 DIAGNOSIS/JUDGMENT_RUBRICS 的正式規則」＝結構性修改，先問使用者 |
| `docs/research/*` | ✅ | 研究產物，自由新增 |
| `docs/MODEL_DISPATCH.md` 的「調度對照表」與「未確認事項」 | ✅ 依實測更新 | 改前把舊值記進 LESSONS.md，套第二節四欄格式（例：情境＝調整調度表；踩了什麼＝原設 haiku 錯誤率高；正確做法＝該列改 sonnet；影響檔案＝MODEL_DISPATCH.md §三） |
| `CLAUDE.md` | ⚠️ 只准改「路由表」的增行與 WORKLOG 相關小修 | 改硬規則、不變量、結構 → **先問使用者** |
| `docs/PRODUCT_SPEC.md` | ⚠️ 只在規格原檔（HTML）更新後同步 | 憑對話印象改規格 → 先問使用者 |
| `docs/JUDGMENT_RUBRICS.md`、`docs/TASK_TEMPLATES.md`、`docs/DIAGNOSIS.md` | ⚠️ 可加正反例，不准刪規則 | 刪除或放寬任何規則 → 先問使用者 |
| `docs/LETTER_TO_FUTURE_SESSIONS.md` | ❌ 歷史文件 | 不改；新的交接寫進 WORKLOG |
| `Dynamic_Keynote_Copilot_Tech_Internal.html` | ❌ | 規格原檔，只有使用者能決定改 |

通用規則（版本保護）：本專案是 git repo，改 ⚠️ 級檔案前確認 `git status` 乾淨、改完階段性 commit 即可回滾——不需 `.bak`（非 git 目錄工作時才用 `.bak`）。✅ 級的追加型檔案（WORKLOG、LESSONS、research/）日常追加更不需特別處理。此規則與 CLAUDE.md 硬規則 4、DIAGNOSIS 次要浪費節一致。

## 二、踩雷教訓寫回哪裡、什麼格式

**寫到 `docs/LESSONS.md`**，一條一則，追加到檔尾。格式（照抄）：

```
## L{編號} {一句話標題}（{YYYY-MM-DD}）
- 情境：當時在做什麼
- 踩了什麼：錯誤或浪費的具體樣子（附錯誤訊息原文更好）
- 正確做法：下次照做的具體步驟
- 影響檔案：若已把修法寫進某制度檔，註明 檔案＋章節
```

判斷「值不值得記」：**未來 session 沒有這條就會再踩一次** → 記；只跟本次對話有關 → 不記。
與既有 lesson 重複 → 更新舊條目（在原條目補充），不要開新條。

## 三、累積多長要精簡（觸發條件，逐條檢查）

- `LESSONS.md` 超過 **200 行** → 做一次蒸餾：反覆出現的教訓升格成 `DIAGNOSIS.md` 或 `JUDGMENT_RUBRICS.md` 的正式規則（這種結構性修改要先問使用者），過時條目移到 `docs/archive/LESSONS-{日期}.md`。
- `CLAUDE.md` 超過 **150 行** → 屬結構性修改：向使用者**提出**「把最長段落抽成 docs/ 引用檔、路由表掛連結」的方案，經同意後才動手（依第一節許可權，不可自行執行）。
- `WORKLOG.md` 超過 **150 行** → 只保留最近 5 個 session 的紀錄，其餘移到 `docs/archive/`。
- 路由表指向的檔案改名/刪除 → 同一個 commit/回合內更新路由表（死連結是制度失效的開始）。

## 四、WORKLOG.md 格式（跨 session 狀態）

```
## {YYYY-MM-DD} session
- 做了：…（一行一項，附產物路徑）
- 下一步：…（具體到可直接開工）
- 坑/待決：…（沒有就寫「無」）
```

新 session 的紀錄一律**追加在檔案最尾端**；「最新一節」＝檔案最下方的最後一個 `##` 區塊。
新 session 開工第一步就是讀本檔最新一節（CLAUDE.md 已寫入此規則）。

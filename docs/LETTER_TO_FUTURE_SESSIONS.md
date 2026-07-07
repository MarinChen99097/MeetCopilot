# 給後續 session 的信

你接手的是 **MeetCopilot v2**——一次刻意的從零重寫。讀這封信 5 分鐘，省你半天。

## 這是什麼、為什麼重寫

v1（隔壁 `c:/Users/Martin/Desktop/MeetCopilot`）是「單一會中簡報 Copilot」，已可跑但範圍太小。使用者要把它擴成**一個平台、CRM 為核心、三個消費端**：DynamicSlide（動態簡報）、會中副駕、語音模擬訓練。使用者選了「從零重寫、同棧」。**v1 不動、當參考件**——它有很多可借的實作（slide-spec、SSRF 抽取器、pptx 匯出、wizard、生成器+QA、CSS、patch-service 的 I1/I2 guard、authz 修正）。借碼＝讀 v1、在 v2 重寫對齊新契約。

## 第一件事：讀四份，別急著寫碼

1. `00-DECISIONS.md`——14 項已拍板 + 會議模型。**這些是既定前提，別重問使用者、別自行推翻。**
2. `PRODUCT_SPEC.md`——三產品一核心怎麼運作。
3. `ARCHITECTURE_PLAN.md`——M0–M5 里程碑（有可測驗收）＋ S1–S5 spike。**這是你的執行清單。**
4. `research/API_FINDINGS.md`——Gemini Live/生圖 model ID、擷取限制。**這些是查證過的事實，別憑訓練記憶猜**（model 名到 2026-07 已變）。

## 三個最容易踩的雷（都寫進 API_FINDINGS 了）

1. **別拿 Gemini Live API 做會議 ASR**——它沒有 speaker diarization、為單一使用者設計、單場 15 分鐘。會議轉寫走 Gemini 分段轉寫（藏在 `AsrProvider` 後）。Live API 只給**語音模擬訓練**。
2. **雙帳號的「同瀏覽器」陷阱**——分頁 picker 只列**同一個 Chromium profile** 的分頁（UA 行為），所以 B 的 Meet 分頁與 Copilot 擷取分頁**放同 profile 才是可靠路徑**（跨 profile 有 Window-surface 備援，音訊可得性 S1 一併驗）。接收端**只有 Chrome/Edge 桌面**能擷取。這是 **S1 spike**，最高風險，動工優先驗。
3. **AI 生圖預設會前預生**——延遲無官方數字（第三方估：flash 級 2–4s、flash-lite 目標 sub-2s；S5 實測校準），且**會中被內容安全誤擋不可在客戶面前發生**；會中即時預設只走 CSS 沿用風格路徑，「會中 1K 快速生圖」選配由 S5 實測後決定。

## 從哪開始

**M0 地基**：monorepo（workspaces）→ `packages/shared` 契約（slide-spec append-only、protocol、signals、crm types、trust-rule 純函式）→ `packages/crm`（DbPort、migration runner、base repository org-scoping）→ auth（JWT fail-fast）→ i18n → gemini client。**平行派 S1/S3/S4 spike**（fresh agent 實測）。S1 敗 → 停下問使用者（音訊地基不成立）。

## 工作紀律（v1 血淚，別重蹈）

- **指揮官不下場**：讀 3+ 檔/掃目錄/驗證 → 派 subagent（模型分工見 MODEL_DISPATCH 覆寫節：Fable 決策、搜尋/調查/驗證一律 opus），主線只收結論＋`檔案:行號`。
- **平行 agent 先凍結契約**：v1 三個平行 agent 各自改契約 → 前後端跑不通。並行前把 shared 契約定死。
- **授權用攻擊者憑證測**：I2/authz 用非 presenter、跨 org 憑證測「被拒」，不是只測正路。
- **Gemini responseSchema 用 union-superset**：v1 把 block 定成空 `{type:OBJECT}` → Gemini 吐 `{}` → 全空白頁。type 必填當判別、其餘 optional。
- **警訊先讀地面真相**：判斷前查 DB/實際回應，別憑截圖或顯示名。
- **隨做隨存 + 驗證不自驗**：每完成 commit；宣稱完成前派 fresh agent read-back。

## 使用者是誰

B2B 銷售場景的產品擁有者。要的是「好看 + 好用 + 誠實」。他會自己開瀏覽器實玩、會發現設計問題——所以誠實揭露 gaps（哪些沒實測、哪些是近似），比假裝完美有用。中文（zh-TW）溝通。

祝順利。地基打穩，三線並行才不會散。
— Fable 5, 2026-07-06

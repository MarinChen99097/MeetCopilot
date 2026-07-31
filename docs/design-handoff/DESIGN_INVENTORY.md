# MeetCopilot 全站重設計稿盤點（DESIGN_INVENTORY）

> **本檔定位**：後續所有實作 agent 的**唯一設計真相來源**。所有行號皆指
> `…\scratchpad\design-handoff\MeetCopilot.dc.html`（共 1457 行）。
> 對照的現有前端一律絕對路徑，根為 `c:\Users\Martin\Desktop\MeetCopilot\apps\web\`。
> 盤點者為唯讀 agent，**未修改任何 repo 檔案**。
>
> 檔案結構速記：
> - `1–7`：`<head>`＋`support.js`（dc-runtime）
> - `9–42`：`<x-dc>` 開頭 ＋ `<helmet>`（Google Fonts ＋ 全站 `<style>` token 表）
> - `44–993`：唯一的版面樹（sidebar ＋ 11 個 `sc-if` 畫面）
> - `996–1454`：`<script data-dc-script>`（假資料常數 ＋ `class Component extends DCLogic`，`renderVals()` 回傳所有 `{{ }}` 綁定值）
>
> **dc-runtime 綁定語法**（只需理解到能讀懂設計稿的程度）：
> `{{ x }}` = `renderVals()` 回傳物件的鍵；`<sc-if value="{{ flag }}">` = 條件渲染；
> `<sc-for list="{{ arr }}" as="it">` = 迴圈（`hint-placeholder-count` 只是編輯器預覽用的假筆數，非實際資料）；
> `style-hover="…"` = runtime 產生的 hover 樣式；`onClick="{{ fn }}"` = 綁 `renderVals()` 回傳的函式。
> **設計稿是純 inline style，零 class name**——實作時要自行決定 CSS 架構（見 §D3）。

---

## A. 設計語言（Design Tokens）

### A1. 字體（行 11–13、33）

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
```

| 字族 | 載入字重 | 用途 |
|---|---|---|
| **Space Grotesk** | 400 / 500 / 600 / 700 | 主字體（拉丁字／數字）；`body` 第一順位 |
| **Noto Sans TC** | 400 / 500 / 700 | 繁中 fallback（`body` 第二順位） |
| **IBM Plex Mono** | 400 / 500 / 600 | **kicker（小標籤）、所有數字/時間/計量、tag/badge、meta 文字、表頭**——全站的「機械感」都靠它 |

`body`（行 33）：
```css
body { margin:0; font-family:"Space Grotesk","Noto Sans TC",system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
```
根容器（行 44）另設 `font-size:15px`（＝全站基準字級）。

**現有前端對照**：`apps\web\app\[locale]\layout.tsx` 目前用 `next/font` 的 **Geist + Geist_Mono**（`--font-display` / `--font-mono`），
`globals.css:41-44` 的 `--mc-font` 是 system stack（`-apple-system … PingFang TC / Noto Sans TC / Microsoft JhengHei`）。
→ **遷移面**：三個字族全新，需在 layout 換 `next/font/google`（Space_Grotesk / IBM_Plex_Mono / Noto_Sans_TC）或改走 `<link>`。

### A2. 淺色色表 `:root, [data-theme="light"]`（行 15–23，逐一抄錄）

```css
:root, [data-theme="light"] {
  --bg:#F2EFEA; --panel:#FFFFFF; --panel2:#FAF8F4; --sunk:#EBE7E0;
  --line:#E4DED4; --line2:#F0ECE4;
  --ink:#15130F; --dim:#5C564C; --mute:#9C9488;
  --acc:#12708C; --accSoft:#E3F0F4; --accInk:#FFFFFF; --accLine:#B9D8E1;
  --warn:#A9661A; --warnSoft:#F8EEE0; --warnLine:#EBD6B8;
  --live:#C0403B; --ok:#2F7A55;
  --shadow:0 1px 2px rgba(21,19,15,.05), 0 8px 24px rgba(21,19,15,.05);
}
```

| Token | 淺色值 | 語意（依實際用法歸納） |
|---|---|---|
| `--bg` | `#F2EFEA` | 頁面底（暖米白） |
| `--panel` | `#FFFFFF` | 卡片／面板底（最亮層） |
| `--panel2` | `#FAF8F4` | 側欄／表頭／次級面板底 |
| `--sunk` | `#EBE7E0` | 凹陷面：進度條槽、avatar 底、縮圖佔位、segmented 控制底 |
| `--line` | `#E4DED4` | 主分隔線／邊框 |
| `--line2` | `#F0ECE4` | 次級分隔線（列表 row 分隔、卡內細線） |
| `--ink` | `#15130F` | 主文字 |
| `--dim` | `#5C564C` | 次文字／說明 |
| `--mute` | `#9C9488` | 三級文字（kicker、meta、單位） |
| `--acc` | `#12708C` | 主色（深青藍）：primary 按鈕、active 態、連結 |
| `--accSoft` | `#E3F0F4` | 主色淡底（active 底、tag 底、卡片強調底） |
| `--accInk` | `#FFFFFF` | 主色底上的字 |
| `--accLine` | `#B9D8E1` | 主色系邊框 |
| `--warn` | `#A9661A` | 提醒／注意（暖棕）：「現在可以這樣說」kicker、must 標籤、時間軸警示段 |
| `--warnSoft` | `#F8EEE0` | 提醒淡底（逐字稿重點行底、「正在講」列底） |
| `--warnLine` | `#EBD6B8` | 提醒邊框 |
| `--live` | `#C0403B` | LIVE 紅：脈衝點、「LIVE」字、逾期／低信心 |
| `--ok` | `#2F7A55` | 成功綠：已備好、正向變化、preflight ✓ |
| `--shadow` | `0 1px 2px rgba(21,19,15,.05), 0 8px 24px rgba(21,19,15,.05)` | 唯一陰影 token（雙層、極輕） |

### A3. 深色色表 `[data-theme="dark"]`（行 24–32，逐一抄錄）

```css
[data-theme="dark"] {
  --bg:#191B1B; --panel:#222525; --panel2:#1D2020; --sunk:#151717;
  --line:#313534; --line2:#282B2B;
  --ink:#E9E6E1; --dim:#ABA79F; --mute:#7B776F;
  --acc:#74C3D3; --accSoft:#1B2C30; --accInk:#0E2429; --accLine:#33565D;
  --warn:#D9A661; --warnSoft:#2B2519; --warnLine:#4E4229;
  --live:#E5716B; --ok:#7FC49B;
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 12px 30px rgba(0,0,0,.28);
}
```

| Token | 深色值 | 備註 |
|---|---|---|
| `--bg` | `#191B1B` | 中性暖灰黑（**不是**現有前端的深藍 `#0a0f1a`） |
| `--panel` | `#222525` | |
| `--panel2` | `#1D2020` | |
| `--sunk` | `#151717` | 深色時 sunk **比 bg 更暗**（淺色時比 bg 更暗但方向相反邏輯一致） |
| `--line` | `#313534` | |
| `--line2` | `#282B2B` | |
| `--ink` | `#E9E6E1` | |
| `--dim` | `#ABA79F` | |
| `--mute` | `#7B776F` | |
| `--acc` | `#74C3D3` | 亮青（淺色是深青 `#12708C`——**明暗反轉**，不是同一色值） |
| `--accSoft` | `#1B2C30` | |
| `--accInk` | `#0E2429` | 深色時主色底上的字是**深色**（因 acc 變亮），實作時不可寫死 `#fff` |
| `--accLine` | `#33565D` | |
| `--warn` | `#D9A661` | |
| `--warnSoft` | `#2B2519` | |
| `--warnLine` | `#4E4229` | |
| `--live` | `#E5716B` | |
| `--ok` | `#7FC49B` | |
| `--shadow` | `0 1px 2px rgba(0,0,0,.3), 0 12px 30px rgba(0,0,0,.28)` | 深色時更重 |

**⚠ 關鍵觀察**：兩份色表**變數名完全相同、只有值不同**，共 18 個 token。
這是乾淨的雙主題契約——實作時只要換值，元件層永不需分支。
與現有 `globals.css` 的 `--mc-*`（30+ 個 token）**沒有一個名字對得上**，是全套替換。

### A4. 圓角刻度（實測分佈）

| 值 | 出現次數 | 典型用途 |
|---|---|---|
| `9px` | 21 | **最常用**：中型按鈕、input、卡片內小卡、tab 按鈕 |
| `10px` | 15 | primary 大按鈕、面板內卡片、VU 表框 |
| `5px` | 13 | 小 tag／badge、mini 縮圖條 |
| `8px` | 12 | 側欄 nav item、小按鈕、avatar（方形） |
| `50%` | 10 | 圓點（脈衝、bullet）、圓形 avatar |
| `14px` | 9 | 大面板／區塊卡（首頁「今天的會議」、CRM 表格容器） |
| `7px` | 8 | segmented 控制外框、極小按鈕 |
| `12px` | 7 | 卡片（stats、CRM 欄位卡） |
| `4px` / `6px` / `3px` | 6 / 5 / 5 | checkbox、進度條、極小 tag |
| `11px` | 4 | 情報卡、avatar 圓角方 |
| `26px` | 1 | **手機模擬框**（HUD 畫面的 phone mock，行 307） |
| `999px` | 1 | pill（連線狀態 pill，行 204） |
| `1px` / `2px` | 3 | 分隔豎線、VU 條 |
| 不對稱 | 5 | `0 6px 6px 0`（逐字稿行）、`0 7px 7px 0`（checklist 列）、`5px 5px 0 0`（柱狀圖）、`3px 3px 0 0`（折線柱）、`6px`（stage slide 用 `6px`） |

**歸納可用刻度**（給實作用的 token 建議，設計稿本身沒定義變數）：
`3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 14`＋`999`＋`50%`；`26px` 僅手機框專用。
→ 比現有 `globals.css:36-39` 的三檔（`--mc-r-sm:8 / md:12 / lg:18`）**細得多**，需擴充刻度。

### A5. 陰影

- 全站唯一 token：`--shadow`（雙層、淺色極輕／深色較重），用於 primary CTA（行 100）、手機 mock（307）、編輯器 slide 畫布（563）。
- **例外硬寫**：舞台上的 16:9 投影片 `box-shadow:0 40px 90px rgba(0,0,0,.5)`（行 399）——舞台不吃主題。

### A6. 動畫 keyframes（行 38–40）＋ 使用點

```css
@keyframes mcPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
@keyframes mcRise  { from{opacity:0; transform:translateY(7px)} to{opacity:1; transform:none} }
@keyframes mcSpin  { to{transform:rotate(360deg)} }
```

| keyframe | 使用 | 行號 |
|---|---|---|
| `mcPulse 1.6s ease-in-out infinite` | 側欄 live 群組圓點(61)、首頁 CTA 圓點(101)、cockpit LIVE 點(171)、HUD 開會中點(309) |
| `mcPulse 1.4s ease-in-out infinite` | 逐字稿「邊聽邊打字」指示點(236) |
| `mcRise .3s ease both` | 深查進行中列(226)、情報卡(277)、HUD 情報卡(331 未加) |
| `mcRise .35s ease both` | 逐字稿新行(241) |
| `mcSpin .8s linear infinite` | 深查 spinner(227) |

**transition（4 處，全是量值變化，沒有任何 hover transition）**：
`height .2s ease`（VU 條 177、912）、`width .4s cubic-bezier(.2,.8,.2,1)`（checklist 進度 256）、
`width .4s ease`（HUD 進度 316）、`width .5s ease`（評分條 900）。
→ hover 全靠 `style-hover` 屬性瞬時切換，**設計稿刻意沒有 hover 過場**。

### A7. mono kicker 樣式慣例（全站最重要的重複 pattern）

固定寫法（出現 30+ 次）：
```css
font-family:'IBM Plex Mono',monospace;
font-size:10px | 10.5px | 11px | 11.5px | 12px;
letter-spacing:.1em | .12em | .14em | .16em | .18em | .2em;
color:var(--mute) | var(--warn) | var(--acc) | var(--live);
```
- **區塊小標（section kicker）**：`10.5px / .14em / var(--mute)`（最典型，如行 121、186、235、253）
- **頁面 kicker**（h1 上方）：`10.5px / .16em / var(--mute)`（行 96、296、357、426）
- **投影片 eyebrow**：`11px / .18em / var(--warn)`（行 567、749）；`12px / .2em`（791）；舞台上 `15px / .16em`（400）
- **側欄群組 kicker**：`10px / .14em / var(--mute)`（行 59）
- **警示 kicker**：`10.5px / .14em / var(--warn)`（行 214、321）
- 全部**不做 `text-transform:uppercase`**（因為內容是繁中）。英文縮寫（`LIVE`、`TODAY`、`EN`）靠內容本身大寫。

**與現有 `.mc-kicker`（globals.css:201-213）的差異**：現有版有 `::before` 圓點、`text-transform:uppercase`、`font-weight:600`、`.16em`；
設計稿的 kicker **沒有 ::before 圓點**（live 圓點是獨立 `<span>`，見行 61），也不粗體。

### A8. 標題字級刻度（-letter-spacing 收緊是全站特徵）

| 用途 | 字級 | 字重 | letter-spacing | 行號例 |
|---|---|---|---|---|
| 首頁 h1 | 32px | 600 | `-.02em` | 97 |
| 頁面 h1（present/train/spend/crm/team） | 29–30px | 600 | `-.02em` | 358、427、867、930、966 |
| HUD h1 | 27px | 600 | `-.02em` | 297 |
| 公司詳情 h1 | 27px | 600 | `-.02em` | 474 |
| cockpit 主建議 | 26px | 600 | `-.015em` | 218 |
| 舞台投影片 h2 | 52px | 600 | `-.02em` | 401 |
| 編輯器投影片 h2 | 23–30px | 600 | `-.02em` | 各模板 |
| 單一大數字 | 96px | 700 | `-.04em` | 784 |
| 封面 h1 | 46px | 700 | `-.03em` | 792 |
| 內文基準 | 15px | — | — | 44 |
| 卡片內文 | 12.5–14.5px | — | — | 全站 |

`text-wrap:pretty` 用在 6 處長文（218、219、322、503、629、764）。

### A9. 主題模型（**實作最關鍵的一節**）

- **預設淺色**：`:root` 與 `[data-theme="light"]` 共用同一份宣告（行 15），所以**沒有 `data-theme` 屬性時就是淺色**。
- 切換機制：`data-theme` 屬性掛在**根 `<div>`**（行 44 `<div data-theme="{{ theme }}" …>`），**不是 `<html>`**。
  `theme` 來自 `renderVals()` 的 `theme = st.theme ?? this.props.theme ?? "light"`（行 1085）。
- 切換 UI：側欄標頭右側一個 segmented 雙鈕 `☀`／`☾`（行 50–53），22×20px，`--accSoft`/`--acc` 表示 active。
  由 `setLight`／`setDark` 驅動（行 1158–1160）。
  **因為在側欄，所以除了「乾淨舞台」以外的每個畫面都看得到它**（舞台在原型裡也還有側欄——見 §D4 風險）。
- 語言切換：側欄底部另一個 segmented 雙鈕「中文／EN」（行 82–85，`setZh`/`setEn`，行 1161–1163）。
  設計稿只翻譯了 3 個字串（`tHomeTitle`/`tHomeLead`/`tEnterCopilot`，行 1165–1168），其餘全硬寫繁中——**i18n 覆蓋率是設計稿的缺口，不是設計決定**。
- **舞台（stage）畫面完全不吃主題**：底 `#111211`、投影片 `#F7F5F1`、字 `#15130F`、eyebrow `#A9661A`、控制列 `#2E312E`/`#C9C6BF`/`#8E8B84`（行 397–416 全硬寫 hex）。
  → 語意：**投影出去的畫面永遠是淺色**，與 app 主題脫鉤。這是設計意圖（投影機／螢幕分享一致性），實作時要保留。

---

## B. 畫面清單（11 個 `sc-if` 畫面 ＋ 全站 sidebar）

`startScreen` prop 可選值（行 996 的 `data-props`）：`home / copilot / hud / crm / studio / train / spend`
（`present`、`stage`、`company`、`team` 只能靠畫面內導覽到達）。
畫面切換邏輯：`screen = st.screen ?? props.startScreen ?? "home"`，`on(k) = screen === k`（行 1091–1092）。

### B0. 全站 Sidebar（行 44–87）

| 項目 | 內容 |
|---|---|
| **版面** | 根 `<div>` 是 2 欄 grid：`238px minmax(0,1fr)`，`height:100vh; overflow:hidden`（行 44）。左 `<aside>` 底 `--panel2`＋右邊框；右欄 `overflow:auto`（行 89）。 |
| **標頭**（47–54） | 26×26 圓角方 logo（`--acc` 底、白字「M」、`border-radius:8px`）＋ wordmark「MeetCopilot」15.5px/600 ＋ 右側 `☀`/`☾` 主題切換 |
| **nav**（56–72） | `sc-for navGroups` → 每組：mono kicker（10px/.14em/mute）＋ 可選 live 脈衝點 → `sc-for g.items` → 每項 34px 高按鈕：`glyph`(16px 寬,字符圖示) ＋ `label`(14px) ＋ `en`(mono 9.5px/mute) |
| **nav 資料**（1099–1105） | 5 組：<br>①`每天先看這裡`：`home`「今天 TODAY ◆」<br>②`開會前 · 準備`：`crm`「客戶資料 CLIENTS ▣」、`studio`「做簡報 SLIDES ▤」<br>③`開會中 · 進行`（**live:true**）：`present`「投影簡報 SHOW ▶」、`copilot`「開會小幫手 LIVE ◉」<br>④`自己練習`：`train`「練習對話 PRACTICE ◐」<br>⑤`管理`：`spend`「用了多少錢 COST $」、`team`「團隊成員 TEAM ◍」 |
| **active 邏輯**（1110） | `stage` 算 `present` active；`company` 算 `crm` active；`hud` 算 `copilot` active |
| **頁腳**（74–86） | 28×28 avatar（mono「CM」）＋ 姓名「陳麥林」13px/500 ＋ mono 10px「管理者 · 睿智科技」；下方「中文／EN」segmented |
| **綁定欄位** | `navGroups[].{kicker,live,items[].{label,en,glyph,go,bg,fg,weight}}`、`setLight/setDark/lightBg/lightFg/darkBg/darkFg`、`setZh/setEn/zhBg/zhFg/enBg/enFg` |

**對應現有前端**：`apps\web\components\AppShell.tsx`（`Sidebar` / `SidebarFoot`）＋ `globals.css:394-545`（`.mc-shell` / `.mc-sidebar*`）。

**行為差異（重要）**：
1. **圖示從 SVG 改字符**：現有用 inline SVG（`AppShell.tsx:335-397` 的 `ICON_PATHS`，10 個 icon）；設計稿改用 `◆ ▣ ▤ ▶ ◉ ◐ $ ◍` 幾何字符。→ 現有 SVG icon set 可整組廢除，或設計稿只是佔位（**需向使用者確認**）。
2. **每項多一個英文縮寫欄**（`en`：`TODAY/CLIENTS/SLIDES/SHOW/LIVE/PRACTICE/COST/TEAM`）——現有沒有。
3. **nav 標籤全改口語繁中**：`CRM 公司`→`客戶資料`、`簡報工作室`→`做簡報`、`MeetCopilot`→`開會小幫手`、`模擬訓練`→`練習對話`、`AI 花費`→`用了多少錢`。
4. **少了 `/sim`（會議模擬器）群組**——現有 `AppShell.tsx:137-140` 有「測試」群組。設計稿完全沒有它。
5. **少了「登出」按鈕**——現有 `SidebarFoot` 有（`AppShell.tsx:280-282`）。
6. **少了側欄收合（rail）功能**——現有有 `is-rail` 64px 模式＋localStorage 記憶（`AppShell.tsx:30,40-47`）。設計稿固定 238px。
7. **少了 RWD off-canvas drawer**——現有 ≤880px 有漢堡＋抽屜（`globals.css:548-599`）。設計稿是固定 2 欄、`height:100vh; overflow:hidden`，**沒有任何 media query**（全檔 0 個 `@media`）。
8. **`adminOnly` 權限分支消失**：現有 spend/team 僅 owner/admin 可見（`AppShell.tsx:142-148,193`）；設計稿的「管理」群組無條件顯示。**實作時必須保留權限判斷**。
9. 主題切換鈕、`en` 欄、238px 寬（現 248px）都是新的。

---

### B1. 首頁「今天」（行 92–164）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isHome` 行 92–164 |
| **版面** | `main` `padding:32px 36px 48px`、`max-width:1300px`、flex column gap 24px。<br>① header：flex，左 kicker（日期）＋h1 32px＋lead；右側 primary CTA（`margin-left:auto`，46px 高，帶脈衝圓點）<br>② stats 列：**4 欄 grid** `repeat(4,minmax(0,1fr))` gap 12px<br>③ 主 section：**2 欄 grid** `1.6fr minmax(0,1fr)` gap 20px，`align-items:start` |
| **左欄（1.6fr）** | 「今天的會議」面板（`border-radius:14px`）：表頭（kicker＋右側 mono「3 場 · 有 2 場還沒準備好」）＋ `sc-for agenda` 每列 **3 欄 grid** `68px minmax(0,1fr) auto`：時間/時長（mono 15px＋10px）｜標題 15px/600＋參與者＋就緒狀態｜CTA 按鈕 34px |
| **右欄（1fr）** | `sc-for phases` 3 張卡：tag（mono 10px/.14em）＋標題 13.5px；卡內 `sc-for p.links` 每個是 9px/10px padding 的按鈕列（glyph＋label 13.5px＋desc 11.5px＋`›`） |
| **對應現有** | `apps\web\app\[locale]\page.tsx` → `apps\web\components\home\HomeDashboard.tsx` |
| **互動元素** | primary「打開開會小幫手」→ copilot；4 張 stat 卡（唯讀）；3 列 agenda CTA（→ copilot / company / train）；phases 內 5 個導覽按鈕（crm / studio / present / copilot / train） |
| **綁定欄位** | `tHomeTitle`、`tHomeLead`、`tEnterCopilot`、`goCopilot`、<br>`stats[].{k,v,unit,delta,deltaColor}`（1175–1180）、<br>`agenda[].{time,dur,title,who,ready,readyColor,cta,bg,btnBg,btnFg,btnLine,go}`（1181–1185）、<br>`phases[].{tag,tagColor,title,links[].{glyph,label,desc,go}}`（1186–1195） |

**行為差異**：
- 現有 `HomeDashboard.tsx` 是**純導覽三欄 flow**（PRE / LIVE / DRILL 三個 phase 卡 ＋ 中間動畫 rail），**零 API 資料**（只讀 `useMe()` 顯示名字）。
- 設計稿新增**兩塊真實資料區**：① 4 個 KPI（本週會議數、該講的都講到 %、建議採用率 %、本月費用）② **今日議程列表**（時間、時長、參與者、就緒狀態、CTA）。
- 設計稿的三個 phase 卡從「主舞台」降級成右欄窄卡，主舞台讓給議程。
- 現有的動畫 rail（`.mc-flow__rail` / `__pulse`）在設計稿裡消失。
- **這是全站最大的資料缺口來源**（見 §D1）。

---

### B2. 會中副駕 Cockpit（行 167–289）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isCopilot` 行 167–289 |
| **版面** | **3 欄 grid**：`230px minmax(460px,1fr) 372px`；`grid-template-rows:minmax(0,100vh)`、`height:100vh`、**`min-width:1120px`**（桌機專用，不做 RWD） |
| **左欄 230px**（169–199） | 底 `--panel2`＋右邊框，padding 16/14，flex column gap 15px：<br>① LIVE 列：脈衝點＋「LIVE」mono 12px/600/.1em/live＋右側時鐘 mono 19px<br>② **VU 表**：46px 高框，`sc-for vu`（22 條），每條 `flex:1`＋`--acc`＋`transition:height .2s`<br>③「■ 停止聆聽 / ● 開始聆聽」44px 主按鈕＋「把提示傳到手機」38px ghost<br>④ 1px 分隔線<br>⑤「這場會議」kicker＋`sc-for session` 4 列 key/value（12.5px）<br>⑥ `margin-top:auto`：「這場花的錢」kicker＋6px 進度條（38%、`--warn`）＋「4.12 美元 / 這場上限 11.00」 |
| **中欄（主舞台）**（201–248） | ① 頂列 13/20 padding、底 `--panel2`：會議標題 15px/600 ＋ 連線 pill（`999px`、mono 11px、accSoft 底）＋ mono 鍵盤提示「A 照著說　S 跳過」＋ 右側「電腦版／手機版」segmented<br>② **建議主卡**（212–231，底 `--panel`）：kicker 列（「現在可以這樣說 · 第 {{sugPos}} 則」warn ／「{{sugTtl}} 後失效」／「後面還有 {{sugRest}} 則」）＋ **建議標題 26px/600/1.36**＋ 理由 14.5px/dim/max-760px ＋ 三顆按鈕「照這樣說(primary 40px) ／ 跳過 ／ 幫我查一下」＋ `sc-if researching` 的深查進行中列（spinner＋「今天還能查 4 次」）<br>③ **逐字稿區**（233–247，`flex:1`）：kicker 列（＋脈衝點＋「重要的話會標色」）＋捲動區 `sc-for lines` 每行 **2 欄 grid** `58px minmax(0,1fr)`：時間 mono 11.5px ｜ 內文 14.5px（重點行加 `--warnSoft` 底＋2px `--warn` 左框＋`0 6px 6px 0` 圓角） |
| **右欄 372px**（250–287） | ① **checklist 區**（251–269，底邊框）：kicker「今天要講、要問的事」＋右側 mono `{{done}}/{{total}}` 13px ＋ 5px 進度條（`width:{{pct}}`、`cubic-bezier(.2,.8,.2,1)`）＋ **`max-height:246px` 捲動清單**，`sc-for checklist` 每項是按鈕：16×16 checkbox（4px 圓角）＋標題 13.5px（已完成加 `line-through`＋`--mute`）＋meta mono 10px＋右側分類 tag（mono 9.5px，must 用 warn 色框）；「正在講」的項目底 `--warnSoft`＋2px warn 左脊<br>② **2 個 tab**（271–274）：「對方的資料 ／ 我們可以說」各 `flex:1` 32px 高<br>③ 情報卡流（275–286，`flex:1` 捲動）：`sc-for intel` 每卡 `border-radius:11px`：kind（mono 9.5px/.1em/kindColor）＋右側 src（mono 9.5px/mute）＋標題 14px/600＋內文 12.5px |
| **對應現有** | `apps\web\app\[locale]\copilot\page.tsx` → `apps\web\components\copilot\CockpitView.tsx`（＋`CopilotView.tsx` 的 `CopilotInner`、`VuMeter.tsx`）；右欄內容對應 `apps\web\components\hud\*` 的 `HudInner` |
| **互動元素** | 停止/開始聆聽、把提示傳到手機（→hud）、電腦版/手機版 segmented、照這樣說/跳過/幫我查一下、checklist 每項可點切換、對方的資料/我們可以說 tab、鍵盤 A/S |
| **綁定欄位** | `clock`、`vu[]`、`toggleCapture/capLabel/capBg/capFg`、`goHud`、`session[].{k,v}`、<br>`sugTitle/sugWhy/sugPos/sugTtl/sugRest`、`accept/skip/deepen/researching`、<br>`lines[].{t,who,text,color,hiBg,hiLine,pad}`、<br>`checklist[].{title,tag,meta,metaColor,toggle,mark,bg,boxBorder,boxBg,fg,deco,tagColor,tagLine,spine}`、`done/total/pct`、<br>`intel[].{kind,kindColor,title,body,src}`、`tabThem/tabUs/them*/us*`、`deskBg/deskFg/phoneBg/phoneFg` |

**行為差異（本畫面差異最大）**：
1. **從 2 欄變 3 欄**。現有 `.mc-cockpit__grid` 是 `340px / minmax(0,1fr)`（擷取端 ＋ HUD 面板堆疊）；設計稿拆成「擷取控制／逐字稿主舞台／情報＋清單」三軸。
2. **建議從「佇列卡片列」變成「單一巨型主卡」**。現有 `SuggestionQueue.tsx` 是多張 `mc-sugcard` 垂直堆疊、每張帶倒數 bar ＋ `SlidePreview` 投影片縮圖 ＋「接受／略過／編輯後接受」三鈕。設計稿改成**一次只顯示一則**（`第 1/3 則`、`後面還有 N 則`），且：
   - **沒有投影片縮圖**（`SlidePreview` 沒有位置）
   - **沒有「編輯後接受」**（I2 的 EDIT 分支在設計稿裡消失！）→ **見 §D5**
   - 第三顆鈕改成「幫我查一下」（＝deep research，現有是獨立的 `DeepResearchBox` 面板）
   - 動作文案從「接受/略過」改成「照這樣說／跳過」——語意從「批准一頁投影片」漂移成「照唸一句話」→ **見 §D5**
3. **逐字稿升級為中欄主體**（現有 `TranscriptStream.tsx` 只是 HUD 的一個中段面板）；新增「重要的話會標色」的 highlight 機制（`hi:true` → warn 底＋左框）。
4. **checklist 從「可收合的一條 bar」變成常駐清單**。現有 `ChecklistPanel.tsx` 預設收合成 ≤48px 一條（刻意不擠掉建議佇列），展開才分 talk/ask/address 三組。設計稿是**常駐 246px 捲動清單、不分組、混排**，靠右側 tag（`要講`/`要問`/`要回答`）區分，並用左脊＋warn 底標示「正在講」。
5. **情報卡＋battlecard 收進 2 個 tab**（「對方的資料」＝`INTEL_THEM`、「我們可以說」＝`INTEL_US`）。現有 `InfoCardStream.tsx` 是單一混流、靠 `kind` badge（5 種）＋trust badge 區分，**沒有 tab**。
6. **新增「這場花的錢」即時成本條**（38% / 上限 11.00 美元）——現有 cockpit 完全沒有成本顯示。
7. **新增「這場會議」metadata 列**（會議 / 用的簡報 / 這台的角色（負責收音，不分享） / 手機提示（已連上 1 台））。現有是 `StatusBar` 的 `<dl>`（連線 / 已連角色 / 已播頁 / 同意狀態）——**語意重寫成人話**。
8. **「同意（consent）」UI 消失**：現有 `CopilotInner` 有 `ConsentGate` checkbox＋`TabShareTutorial` 三步驟教學＋setup 表單（會議標題、選簡報、選公司、會議目標）。設計稿的 cockpit **假設 session 已存在**，沒有 setup 相位、沒有同意勾選、沒有分頁分享教學。→ **見 §D5**
9. `zero-track` / `error` / `ended` 三種例外態在設計稿裡都沒有畫。
10. 「把提示傳到手機」取代現有的 `<details>` HUD 連結複製區。

---

### B3. HUD 第二裝置（行 292–351）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isHud` 行 292–351 |
| **版面** | ⚠ **這不是手機視窗，是一個「桌機說明頁」裡放一台手機模擬器**。<br>`main` `min-height:100vh; padding:28px 36px 44px`，flex column gap 20px：<br>① header：kicker「開會小幫手 · 手機版（同一場會議）」＋h1 27px「手機提示 · 只有你看得到」＋說明 14.5px/max-620px ＋ 右側「電腦版／手機版」segmented<br>② flex row gap 24px `flex-wrap`：**左＝392×748px 手機框**（`border-radius:26px`＋`--shadow`）；**右＝`flex:1 min-width:320px` 的 3 張說明卡** |
| **手機框內容**（307–338） | ① 頂列：脈衝點＋mono 11.5px「開會中 {{clock}}」＋右側 mono 11px「Acme · 簡報第 4/12 頁」<br>② 進度列（底 `--panel2`）：mono 12px「講了 {{done}} / {{total}} 件」＋ `flex:1` 5px 進度條 ＋ 單行省略「接下來要講：{{nextItem}}」<br>③ 建議區：kicker「現在可以這樣說 · {{sugTtl}} 後失效」（warn）＋標題 **19px**/600 ＋ 兩鈕「照這樣說（`flex:1`, 46px）／跳過（96px 固定）」<br>④ `flex:1` 捲動區：kicker「會議中查到的資料」＋`sc-for intel` 每卡 `border-radius:10px`（kind＋標題 14px＋內文 12.5px） |
| **右側說明卡**（340–348） | `sc-for hudNotes` 3 張（1231–1235）：「為什麼分成兩個畫面／投影出去的只有簡報」「為手機設計／一眼看到重點」「網路斷掉也沒事／重新連上就自動同步」——**這是設計說明文案，不是產品 UI** |
| **對應現有** | `apps\web\app\[locale]\hud\page.tsx` → `apps\web\components\hud\HudView.tsx`（`HudInner`）＋六個子面板 |
| **互動元素** | 電腦版／手機版 segnented、照這樣說、跳過、（手機框內清單不可點——只顯示進度＋下一項） |
| **綁定欄位** | `clock`、`done/total/pct/nextItem`、`sugTtl/sugTitle`、`accept/skip`、`intel[]`、`hudNotes[].{k,title,body}`、`deskBg/deskFg/phoneBg/phoneFg` |

**行為差異**：
1. **面板數從 6 降到 3**：現有 `HudInner` 依序渲染 `banner → ChecklistPanel → SuggestionQueue → TranscriptStream → InfoCardStream → DeepResearchBox`（桌機斷點升 2 欄）。設計稿手機版只有 **進度條＋下一項｜建議｜情報卡** 三塊——**逐字稿與深查在手機版被完全移除**。
2. **checklist 在手機版降級成「一行進度＋下一項標題」**（不可展開、不可勾選）。現有 `ChecklistPanel` 手機也能展開勾選/略過。
3. 建議卡同 §B2 的問題：無縮圖、無「編輯後接受」。
4. **沒有 `ConnectPanel`（貼 session 連結）與 `ConnectingState`**——現有 `/hud` 獨立開啟時要先貼連結才能連（`HudView.tsx`）。設計稿假設已連上。
5. 現有 `/hud` **不掛 AppShell**（`app\[locale]\hud\page.tsx`）；設計稿的 hud 畫面**在 sidebar 裡**（因為原型是單一 shell）。→ 實作時 `/hud` 必須維持零 chrome，這頁的側欄是原型產物。
6. 右側 3 張說明卡是**設計稿的自我說明**，不應照做（見 §D6）。

---

### B4. 上台前確認 Present start（行 354–393）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isPresent` 行 354–393 |
| **版面** | `main` `min-height:100vh; padding:32px 36px 48px`、**`max-width:1120px`**、flex column gap 22px：<br>① header：kicker「上台前確認」＋h1 30px「選簡報，確認三件事就可以開始」＋lead「按開始後只會顯示簡報，可以放心分享螢幕。」<br>② **2 欄 grid** `minmax(0,1fr) 340px` gap 20px `align-items:start` |
| **左欄** | kicker「選一份簡報」＋`sc-for decks` 每張是 **3 欄 grid 按鈕** `104px minmax(0,1fr) auto`：58px 高縮圖佔位（`--sunk`，mono 10px「{{pages}} 頁」）｜標題 15px/600＋meta 12.5px｜mono 11px「已選／選擇」；選中時邊框 `--acc`、底 `--accSoft` |
| **右欄 340px** | 卡（`border-radius:14px`）：kicker「開始前確認三件事」＋`sc-for preflight` 3 列（18px 圓形 ✓ 點＋標題 13.5px＋說明 12px，底邊框 `--line2`）＋ **「開始播放」48px primary** ＋ 底部 mono-less 11.5px 置中「Esc 離開 · ← → 換頁 · 提示只在你手機上」 |
| **對應現有** | `apps\web\app\[locale]\present\start\page.tsx` → `apps\web\components\present\PresentStart.tsx` |
| **互動元素** | deck 選擇（3 張）、「開始播放」→ stage |
| **綁定欄位** | `decks[].{title,meta,pages,mark,markColor,pick,line,bg}`（1237–1247）、`preflight[].{title,desc,mark,dotBg,dotFg}`（1248–1252）、`goStage` |

**行為差異**：
1. **deck 從卡片 grid 變成橫向列表列**（現有 `.mc-deckgrid` 是 `auto-fill minmax(240px,1fr)` 卡片牆；設計稿是 3 欄一列的清單，帶頁數縮圖佔位）。
2. **新增「開始前確認三件事」preflight 面板**：收音正常／手機提示已連上／要講的事已備好。→ 現有完全沒有 preflight 概念（**新功能**，見 §D1）。
3. **啟動從兩顆鈕收斂成一顆**。現有有「靜態播放」（primary）＋「連線會議播放」（ghost，需 meeting creds，無 creds 時 disabled）兩條路。設計稿只有「開始播放」——**兩條播放路徑的區別在設計稿裡消失了**，需決定映射（建議：preflight 通過→連線播放；否則靜態）。
4. 現有 deck 卡顯示語言 badge（繁中/EN）＋頁數＋更新時間；設計稿的 `meta` 是自由字串「12 頁 · 昨天更新 · 已備好要講的事」——多了「已備好要講的事」這個後端沒有的欄位（見 §D1）。

---

### B5. 乾淨舞台 Stage（行 396–418）★ I3 關鍵畫面

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isStage` 行 396–418 |
| **版面** | `main` `height:100vh`、底 **`#111211`**（硬寫，不吃主題）、flex column：<br>① `flex:1` 置中區 `padding:56px`：**16:9 投影片**（`width:100%; max-width:1120px; aspect-ratio:16/9`、底 `#F7F5F1`、`border-radius:6px`、`padding:64px 72px`、字 `#15130F`、`box-shadow:0 40px 90px rgba(0,0,0,.5)`）<br>② 底部控制列 `padding:0 24px 20px`、色 `#8E8B84` |
| **投影片內容**（400–410） | eyebrow mono **15px**/.16em/`#A9661A`「第 4 頁 · 什麼時候能上線」＋ h2 **52px**/600/-.02em ＋ **3 欄 grid** gap 20px：`sc-for slideCols` 每欄 `border-top:2px solid #15130F`＋`padding-top:16px`：mono 14px 標籤 ＋ 30px/600 值 ＋ 16px/1.5 說明 |
| **控制列**（413–416） | ① 「Esc 離開播放」按鈕（34px、`border:1px solid #2E312E`、色 `#C9C6BF`）② mono 12px「04 / 12 · 只顯示簡報 · 可安全分享」③ `margin-left:auto` mono 12px「要講的事和建議只在你手機上」 |
| **對應現有** | `apps\web\app\[locale]\present\page.tsx` → `apps\web\components\present\PresentStage.tsx` |
| **互動元素** | 「Esc 離開播放」→ present start；文案提到 `← →` 換頁但設計稿沒畫翻頁鈕 |
| **綁定欄位** | `slideCols[].{k,v,d}`（1253–1257）、`goPresent` |

**I3 安全稽核（仔細看的結果）**：
- ✅ **投影片框內零 HUD 元素**：只有 eyebrow＋標題＋3 欄內容。沒有 checklist、沒有建議、沒有逐字稿、沒有情報卡、沒有進度條、沒有 signals。
- ✅ 控制列上的兩句文字是**關於** HUD 的說明（「只顯示簡報 · 可安全分享」「要講的事和建議只在你手機上」），**不含任何 HUD 資料**。不過它們仍是「會被分享出去的畫素」——現有 `PresentStage.tsx` 的控制列刻意做成 hover 才顯著、靜止 2.5 秒淡出，且 `mc-present__pageno` 整塊 `aria-hidden`。**建議實作時把這兩句文字砍掉或改成僅本機淡出提示**，不要常駐在被分享的畫面上。
- 🔴 **原型結構風險**：`isStage` 的 `<main>` 位於行 89 的右欄內，而行 46 的 `<aside>` 側欄是它的兄弟節點且**永遠渲染**。因此**在設計稿裡，舞台畫面是帶著側欄（含使用者名字、組織名、nav、主題切換）出現的**。
  這是「單一 shell 展示所有畫面」的原型產物，但如果實作 agent 照抄結構，就會把 app chrome 帶進被分享的畫面 → **直接違反 I3**。
  → **實作硬要求**：`/present` 必須維持現況（`app\[locale]\layout.tsx` 零 chrome、page 不包 `AppShell`、`PresentStage.tsx` 檔頭 import 白名單）。設計稿的舞台只取「配色＋投影片框＋控制列」的視覺，**不取版面樹**。
- ⚠ 舞台的投影片版面（3 欄 border-top）**與模板陳列室的任何一個都不同**（見 §C 的 `three-col-rule`）。

---

### B6. CRM 清單（行 422–464）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isCrm` 行 422–464 |
| **版面** | `main` `min-height:100vh; padding:30px 36px 48px`、flex column gap 18px（**無 max-width**）：<br>① header：kicker「客戶資料」＋h1 29px「28 家客戶 · 這週要見 6 家」＋右側 primary「＋ 新增客戶」40px<br>② 篩選列：搜尋 input（`flex:1 min-width:260px`, 38px）＋`sc-for crmFilters` 5 顆 38px 篩選鈕（label＋mono 數字）<br>③ **表格**（`border-radius:14px`、`overflow:auto`）：`min-width:940px` 的 **6 欄 grid** |
| **表格欄位**（440–441） | grid `minmax(220px,2.1fr) 108px minmax(180px,1.7fr) 116px 104px 92px`；表頭 mono 10px/.1em/mute：**公司 ｜ 進度 ｜ 誰做決定 ｜ 下次見面 ｜ 資料更新 ｜ 資料可信度** |
| **每列**（443–461） | 整列是按鈕：<br>① 公司：28px avatar（mono 11px 前 2 字）＋名 14.5px/600＋domain mono 10.5px<br>② 進度：mono 10.5px tag（5px 圓角，依狀態換色）<br>③ 誰做決定：13px/dim 單行省略<br>④ 下次見面：mono 12px（hot 用 `--live`）<br>⑤ 資料更新：mono 11.5px/mute（相對時間）<br>⑥ 資料可信度：5px 進度條＋mono 10.5px 百分比（≥75 綠／≥50 warn／<50 live） |
| **假資料**（1038–1047） | 8 家公司，欄位：`name, domain, status, buying, next, crawled, conf, hot` |
| **篩選**（1259–1265） | `全部(28) / 談到一半(9) / 還沒聊過(11) / 已成交(6) / 資料不齊(5)` |
| **狀態色**（1140–1144） | `談到一半`→acc／`已成交`→ok／`沒下文了`→mute／其他（`還沒聊過`）→warn |
| **對應現有** | `apps\web\app\[locale]\crm\page.tsx` → `apps\web\components\crm\CompanyListView.tsx` |
| **互動元素** | 搜尋 input、5 顆篩選鈕、每列點擊→詳情、＋新增客戶 |
| **綁定欄位** | `crmFilters[].{label,n,pick,bg,fg,line,weight}`、`companies[].{name,domain,ini,status,stFg,stLine,stBg,buying,next,nextColor,crawled,conf,confColor,go}` |

**行為差異**：
1. **卡片 grid → 6 欄表格**。現有是 `.mc-companygrid`（`auto-fill minmax(280px,1fr)` 卡片牆），每卡顯示 logo／名／`產業 · 網域`／3 顆 badge／「最後研究：相對時間」。
2. **狀態文案全改口語**：`prospect/active/customer/churned` → `還沒聊過 / 談到一半 / 已成交 / 沒下文了`（**多了一個「資料不齊」是衍生篩選，不是 accountStatus 的值**）。
3. **新增 3 個欄位**：`誰做決定`（decision maker 摘要）、`下次見面`（**後端完全沒有**）、篩選器的每項計數。
4. **篩選從 `<select>` 變成 5 顆帶計數的 chip**。
5. **可信度從 badge 變成進度條＋百分比**（現有 `ConfidenceBadge`）。
6. **分頁消失**：現有有 `PAGE_SIZE=20` ＋「上一頁／第 x/y 頁 · 共 n 家／下一頁」（`mc-pager`）。設計稿沒有任何分頁 UI。
7. **「＋ 新增客戶」的展開表單消失**：現有點擊會展開 `NewCompanyForm`（公司名稱*／網域／官網 URL）。設計稿只有按鈕，沒畫表單（`onClick` 未綁）。

---

### B7. CRM 公司詳情（行 467–534）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isCompany` 行 467–534 |
| **版面** | `main` flex column：<br>① header（底 `--panel2`＋底邊框，`padding:22px 32px 0`）<br>② 內容 `padding:22px 32px 44px`、**2 欄 grid** `minmax(0,1fr) 348px` gap 22px `align-items:start` |
| **header**（469–491） | ①「← 返回客戶資料」mono 11.5px 文字鈕<br>② 身分列：52px avatar（14px 圓角、mono 17px）＋h1 27px ＋ 一行 meta（狀態 tag「洽談中」／`製造 · 供應鏈`／`acme.com.tw`／`員工 1,200 · 台中`，用 1px 豎線分隔）＋右側兩鈕「重新查資料(ghost 38px)／開會時用這份資料(primary 38px)」<br>③ **tab bar**：`sc-for crmTabs` 38px 高，`border-bottom:2px solid`，label＋mono 計數 |
| **tab 清單**（1273–1277） | 5 個：`重點整理(6) / 聯絡人(4) / 他們想買什麼(3) / 會議筆記(7) / 最近動態(12)`（key：`overview/contacts/products/notes/social`）**只有 overview 的內容被畫出來** |
| **左欄（主）**（496–509） | `sc-for companyFields` 每張卡（12px 圓角）：kicker（mono 10px/.12em）＋**來源標籤**（mono 9.5px，4px 圓角，依可信度換色）＋右側 src（mono 10px/mute）＋值 15px/1.55/`text-wrap:pretty` ＋ 兩顆 28px 小鈕「✓ 確認 ／ 編輯」 |
| **右欄 348px**（512–531） | ① 「這家公司誰做決定」卡：`sc-for people` 每列 32px avatar ＋ 名 14px/600＋角色 tag（mono 10px，依角色換色）＋職稱 12.5px ＋ 註記 12px<br>② **warn 提示卡**（`--warnSoft` 底＋`--warnLine` 框）：「資料還可以更完整」＋說明「資料是 7/22 查的，其中 3 項不太確定。」＋「重新查這家公司」34px 鈕 |
| **6 個 overview 欄位**（1278–1285） | `他們今年要做什麼`(你確認過/法說會 7/09/ok)、`他們現在用什麼系統`(系統自動查的/徵才 JD 推測/warn)、`他們怎麼決定要買`(開會時聽到的/7/30 逐字稿 24:41/acc)、`還在比較誰`(不太確定/推測 · 32%/live)、`上次沒解決的事`(你確認過/你於 7/22 記錄/ok)、`我們可以說什麼`(我們的資料/可直接唸/acc) |
| **3 位人物**（1286–1290） | 陳志豪(幫我們推/acc)、林淑芬(最後拍板/warn)、黃威霖(會挑問題/dim) |
| **對應現有** | `apps\web\app\[locale]\crm\[id]\page.tsx` → `apps\web\components\crm\CompanyDetailView.tsx`＋`ChildTabs.tsx`（＋`ContactsTab/ProductsTab/SocialTab/NotesTab/EnrichPanel/PersonaCard/ProvenanceField`） |
| **互動元素** | 返回、重新查資料、開會時用這份資料（→copilot）、5 個 tab、每個欄位卡的「✓ 確認／編輯」、「重新查這家公司」 |
| **綁定欄位** | `crmTabs[].{label,n,pick,fg,line,weight}`、`companyFields[].{k,v,srcTag,src,srcColor,srcLine,srcBg}`、`people[].{ini,name,role,roleColor,title,note}`、`goCrm`、`goCopilot` |

**行為差異**：
1. **tab 從 9 個砍到 5 個，且語意重組**：現有＝`總覽 / 人物 / 產品深檔 / 新聞 / 技術棧 / 社群 / 部門 / 商機 / 筆記`；設計稿＝`重點整理 / 聯絡人 / 他們想買什麼 / 會議筆記 / 最近動態`。
   → 對應猜測：`重點整理`←總覽、`聯絡人`←人物、`他們想買什麼`←產品深檔（或商機）、`會議筆記`←筆記（**現有沒有 notes tab 的實作對照？有 `NotesTab.tsx`，OK**）、`最近動態`←新聞＋社群合併。
   → **消失的 tab**：技術棧、部門、商機（3 個）。技術棧的內容被搬進 overview 的「他們現在用什麼系統」欄位。
2. **overview 從「11 個 ProvenanceField ＋ 4 組 ChipRow」重組成「6 張銷售敘事卡」**。
   現有欄位是**結構化屬性**（標語／產業／商業模式／員工規模／成立年份／總部／官網／營收級距／募資階段／募資總額）＋chips（痛點／策略計畫／採購觸發／現有廠商）。
   設計稿改成**6 個銷售問題的答案**（他們今年要做什麼／現在用什麼系統／怎麼決定要買／還在比較誰／上次沒解決的事／我們可以說什麼）——這是**語意重新設計，不是換皮**。後端有原料（`strategicInitiatives`、`currentVendors`、`painPoints`…）但需要新的聚合/敘事層。→ **見 §D1**
   結構化屬性（員工數／地點／產業）被壓縮進 header 的一行 meta。
3. **provenance 標籤語意重寫**：現有 `ProvenanceBadge`（`trusted/guess/none` ＋ 來源 ＋ ✓確認鈕）；設計稿是 4 種口語標籤「你確認過／系統自動查的／開會時聽到的／不太確定」＋來源字串＋信心百分比（`推測 · 32%`）。
   → 「開會時聽到的」是**新來源類型**（從逐字稿寫回 CRM），現有 `FieldProvenance` 沒有這個來源值。
4. **右欄新增「誰做決定」摘要卡**（3 人＋角色＋一句註記）。現有這些在「人物」tab 裡的 `PersonaCard`。
5. **右欄新增「資料還可以更完整」warn 提示卡**。現有的 `EnrichPanel` 在 header 右側。
6. **header 新增「開會時用這份資料」primary CTA**（→ copilot）——現有沒有這條從 CRM 直接進會的路。
7. 現有 header 的 `dl.mc-counts`（主管/產品/新聞/商機 4 個計數）消失，改成 tab 上的計數 badge。

---

### B8. Studio 簡報編輯器（行 537–860）★ 含模板陳列室

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isStudio` 行 537–860（模板陳列室 565–795，見 §C） |
| **版面** | **3 欄 grid** `196px minmax(520px,1fr) 306px`；`grid-template-rows:minmax(0,100vh)`、`height:100vh`、**`min-width:1120px`** |
| **左欄 196px**（539–551） | 底 `--panel2`，kicker「簡報 12 頁」＋`sc-for slides` 每張縮圖列（8px padding、9px 圓角）：mono 頁碼 ＋ 標題 12.5px ＋ **來源 mono 9.5px**（「你的簡報」mute／「開會中補的」warn）；底部「＋ 新增一頁」虛線鈕 |
| **中欄頂列**（553–561） | deck 標題 15px/600 ＋ mono tag「匯入的 PPTX ＋ 3 頁新增」＋ mono 11px/ok「已自動存檔 · 12:41」＋ 右側兩鈕「整理成要講的事(ghost 34px)／播放(primary 34px)」 |
| **中欄畫布**（562–816） | `padding:22px`、底 `--bg`：<br>① **820×461px 投影片畫布**（`align-self:center`、`--panel` 底、`--line` 框、10px 圓角、`--shadow`）→ 內含 **16 個 `sc-if isT1..isT16`**（§C）<br>② 畫布下方「換一個版型 · 這頁的內容會自動套過去」kicker ＋ **模板選擇條**（`overflow-x:auto`，`sc-for templates` 16 顆 104px 寬卡：42px mini 預覽（由 `t.mini[]` 的彩條組成）＋ 群組 tag（mono 8.5px：`數據/文字/圖表/圖像`）＋ 右側 mono 8.5px「AI 可填」＋ 名稱 11.5px） |
| **右欄 306px**（818–858） | ① **「用你自己的簡報」匯入卡**（虛線 `--accLine` 框＋`--accSoft` 底）：說明「開會中臨時要補的頁，會照這份簡報的字體和顏色新增」＋4 顆格式 tag（`PowerPoint .pptx / PDF / Google 簡報 / Keynote`）＋「選擇檔案匯入」36px primary ＋ 已匯入狀態「供應鏈提案 v4.pptx · 9 頁（保留原樣）」＋ 分隔線下的**主題 token 展示**：`sc-for themeTokens` 4 列（14px 色塊 swatch ＋ 名稱 12px ＋ mono 值）——`主色（從封面取的) #12708C`、`標題字型 思源黑體 Bold`、`內文字型 思源黑體 Regular`、`公司 logo 已抓到`<br>② kicker「這頁的內容」＋`sc-for blocks` 4 張區塊卡（mono kind ＋ mono hint ＋ 值 13px）：`大標題(34px)`、`小標(11px)`、`三欄內容(可拖曳調整順序)`、`自己看的小抄(投影不會顯示)`<br>③ **warn 卡「開會中自動補的頁」**：「對方問到『資安審查要多久』時，小幫手照你的版型補了第 7 頁，字體顏色跟原簡報一致。」＋兩鈕「看那一頁／刪掉」 |
| **對應現有** | `apps\web\app\[locale]\studio\page.tsx` → `StudioView.tsx`（清單頁）；`studio\[deckId]\page.tsx` → `SlideEditor.tsx`＋`BlockEditor.tsx`＋`EditableSlide.tsx`（＋`DeckWizard.tsx`、`ImageJobCard.tsx`） |
| **互動元素** | 12 個縮圖選擇、＋新增一頁、整理成要講的事、播放、16 顆模板切換、選擇檔案匯入、4 個 block 卡（唯讀展示，未綁編輯）、看那一頁／刪掉 |
| **綁定欄位** | `slides[].{n,title,src,srcColor,pick,bg,line,fg}`（1292–1304）、`isT1..isT16`（1312–1315）、`templates[].{name,dir,align,group,groupColor,ai,pick,mini[].{flex,h,c},bg,line,fg,weight}`（1334–1359）、`importKinds[]`、`themeTokens[].{k,v,swatch}`、`blocks[].{k,hint,v}`（1408–1413）、`goPresent`＋各模板自己的資料（見 §C） |

**行為差異**：
1. **Studio 清單頁在設計稿裡不存在**。現有 `/studio` 是 deck 卡片牆（`StudioView.tsx`），`/studio/[deckId]` 才是編輯器。設計稿只畫了編輯器。→ **缺口：deck 清單頁沒有設計**（見 §B12）。
2. **欄寬變化**：現有編輯器 `.mc-editor__grid` 是 `180px / 1fr / 360px`；設計稿 `196px / minmax(520px,1fr) / 306px`。
3. **新增「模板選擇條」（16 顆帶 mini 預覽的橫向卡）**——這是本次設計最大的功能新增。現有換模板只是 `BlockEditor.tsx:50-63` 的一個 `<select>`（6 個選項、無預覽）。
4. **模板從 6 個擴到 16 個**（見 §C）。
5. **新增「主題 token 展示」**（主色/標題字型/內文字型/logo 各一列＋swatch）。現有 `BlockEditor` **完全沒有 theme 編輯或展示 UI**（`SlideTheme` 只在匯入時抽取、生成時繼承）。
6. **新增「開會中自動補的頁」通知卡**（warn 底＋「看那一頁／刪掉」）。現有左欄縮圖有 🔒 鎖標區分已播/原始頁，但**沒有「會中補的頁」的視覺標記或通知**（後端也分不出來——見 §D1 #17）。
7. **左欄縮圖從「投影片實際縮圖」變成「文字列」**：現有 `SlideEditor` 左欄用 `SlideRenderer size="thumb"` 渲染真縮圖；設計稿改成頁碼＋標題＋來源的文字列（無視覺預覽）。
8. **右欄 block 面板從「可編輯 fieldset」變成「唯讀展示卡」**：現有 `BlockEditor` 每個 block 是 `fieldset.mc-blk`（type legend＋↑↓×）＋底部 8 顆「新增區塊」鈕；設計稿的 4 張卡沒有任何編輯控制（只有 mono hint）。→ **編輯能力在設計稿裡沒有畫，實作時必須保留**。
9. **新增「自己看的小抄（投影不會顯示）」block**——對應 `SlideSpec.notes`，現有 `BlockEditor` **沒有** notes 編輯 UI。
10. **消失的功能**：`⬇ 匯出 .pptx/.pdf`、AI 生圖區（prompt＋「生成背景圖」/「整頁生圖」＋`ConfirmDialog` 成本預警）、`ImageJobCard`、`DeckWizard`（3 步生成精靈）、鎖定提示（I1 已播頁唯讀）、匯入中/失敗的狀態卡。**這些都必須保留**。
11. **新增「整理成要講的事」按鈕**（＝從 deck 生成 checklist）——現有沒有這個入口（checklist 生成目前只在會中 WS）。
12. 匯入格式從 `.pptx,.pdf` 擴到宣稱支援 `Google 簡報 / Keynote`（**後端不支援**，見 §D1）。

---

### B9. 練習對話 Train（行 863–922）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isTrain` 行 863–922 |
| **版面** | `main` `padding:30px 36px 48px`、**`max-width:1240px`**、flex column gap 20px：<br>① header：kicker「練習對話」＋h1 29px「上台前先跟難搞的客戶練一輪」＋lead「選一種客戶類型，講 8 分鐘，結束後給你分數和每一句的改法。」<br>② **persona 3 欄 grid** `repeat(3,minmax(0,1fr))` gap 12px<br>③ **2 欄 grid** `minmax(0,1fr) 360px` gap 20px `align-items:start` |
| **persona 卡**（872–888） | 13px 圓角按鈕：34px glyph 方塊 ＋ 名 15px/600 ＋ mono tag（難度・特徵）＋ desc 13px ＋ 3 顆 trait chip（mono 9.5px）；選中時邊框 acc、底 accSoft |
| **左下（1fr）**（892–905） | 上次練習卡（14px 圓角）：kicker「上次練習 · 7/28 · 8 分 12 秒」＋右側 mono/acc「得分 74 / 100」＋`sc-for scores` 6 列 **3 欄 grid** `112px minmax(0,1fr) 42px`（label 13.5px ｜ 7px 進度條（`transition:width .5s`）｜ mono 分數）＋底部分隔線後的「最該改的一句」13.5px/1.65 |
| **右下 360px**（906–919） | 開始練習卡：kicker「開始練習」＋persona 名 14px/600＋情境說明 13px ＋ **VU 表**（40px，`sc-for vu` 22 條，`opacity:.75`）＋「開始練習（8 分鐘）」46px primary ＋ 置中 11.5px「過程會錄音，只用來評分，7 天後自動刪掉」 |
| **3 個 persona**（1146–1150） | `很會殺價的財務長`(難·一直談錢/◈)、`被別家拖過的主管`(中等·在意時程/◇)、`很懂技術的資訊主管`(難·只問技術/◆)，各 3 個 trait |
| **6 個評分維度**（1421–1428） | `開場 82 / 問出需求 76 / 講到對方在意的點 71 / 被質疑時的回應 58 / 談價格 49 / 收尾約下次 88`（色：ok/ok/acc/warn/live/ok） |
| **對應現有** | `apps\web\app\[locale]\train\page.tsx` → `TrainWorkbench.tsx`＋`PersonaPicker.tsx`＋`ScoreReport.tsx`＋`TrainCall.tsx`（＋`SyntheticPersonaCreator.tsx`） |
| **互動元素** | 3 個 persona 選擇、「開始練習（8 分鐘）」 |
| **綁定欄位** | `personas[].{name,tag,glyph,desc,traits[],pick,bg,line}`、`personaName`、`scores[].{k,v,pct,color}`、`vu[]` |

**行為差異**：
1. **persona 從「真人 CRM 聯絡人」變成「客戶類型原型」**。現有 `PersonaPicker.tsx` 是兩種模式（真人／AI 虛擬人物），真人模式列出 CRM contacts（avatar、中文名、職稱·公司、readiness badge「已驗證 n 欄／可對練／缺 xxx」＋「讓 AI 補齊」＋深連結回 CRM）。設計稿改成**3 個抽象人格類型**（財務長／被拖過的主管／資訊主管）——**這是產品語意的重大改變**：不再綁 CRM 資料，變成通用陪練。→ **需向使用者確認是取代還是並存**（見 §D1）。
2. **消失的設定**：情境模式 chips（`sales/partnership/government/interview` 4 個 mode）、對練語言 radio（zh/en/auto）、難度 radio（friendly/neutral/hostile）、「本次目標（選填）」details（salesGoal／meetingPurpose）、`ConfirmDialog`（麥克風/費用預警）。設計稿只有一顆「開始練習（8 分鐘）」。難度被吸收進 persona 的 `tag`（「難／中等」）。
3. **新增「上次練習」摘要面板**（時間、時長、總分 74/100、6 維分數條、最該改的一句）——現有 `ScoreReport` 只在對練結束後顯示，**進入頁面時看不到上次成績**（後端也沒有查詢路徑，見 §D1 #19）。
4. **評分維度從 4 維變 6 維且名稱全不同**。現有 `sales` mode 是`異議處理／需求挖掘／清晰度／收尾`（`packages\shared\src\train.ts:60-65`）；設計稿是`開場／問出需求／講到對方在意的點／被質疑時的回應／談價格／收尾約下次`。→ **契約變更**（`TrainScores` 是 labeled 陣列，值可變，但 mode 定義要改）。
5. **新增「總分 74/100」**——後端 `TrainReport` 無 `overallScore`（見 §D1 #19）。
6. **新增「8 分鐘」時長承諾**與「錄音 7 天後自動刪掉」的資料保留承諾——後端沒有 retention 機制。
7. **通話中畫面（`TrainCall`）沒有設計**：現有有計時器、AI avatar ring＋波形、mic level、即時字幕、語速拉桿（0.5–2×，最近才移到頂部狀態列）、「掛斷並查看評分」。設計稿只在啟動卡放了一個裝飾用 VU 表。→ **缺口**（見 §B12）。
8. **評分報告畫面（`ScoreReport`）沒有獨立設計**：現有有綜合分數大數字、`mc-scoregrid`、summary、「重點時刻」highlight 卡（good/improve＋引言＋評語）、可展開逐字稿。設計稿把它壓成左下的摘要卡。

---

### B10. 用了多少錢 Spend（行 925–958）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isSpend` 行 925–958 |
| **版面** | `main` `padding:30px 36px 48px`、**`max-width:1240px`**、flex column gap 20px：<br>① header：kicker「2026 年 7 月費用」＋h1 29px「126.40 美元 / 這個月上限 300」＋右側 mono 11.5px/ok「月底大約 183 美元 · 沒有超支」<br>② 全寬 9px 進度條（42%、`--acc`）<br>③ **2 欄 grid** `minmax(0,1.5fr) minmax(0,1fr)` gap 20px |
| **左欄（1.5fr）**（937–946） | 「哪些功能花了錢」卡（14px 圓角）：`sc-for spendRows` 5 列 **3 欄 grid** `120px minmax(0,1fr) 78px`（label 13.5px ｜ **20px 高**條狀圖 ｜ mono 12.5px 金額右對齊） |
| **右欄（1fr）**（947–955） | `sc-for spendCards` 3 張卡：kicker（mono 10px/.12em）＋值 22px/600 ＋ 說明 12.5px |
| **5 個 spendRows**（1430–1436） | `開會小幫手 58.20(72%) / 查客戶資料 31.10(39%) / 做簡報 19.40(24%) / 練習對話 12.80(16%,warn) / 臨時幫你查 4.90(6%,warn)` |
| **3 張 spendCards**（1437–1441） | `平均一場會議 4.86 美元`、`最貴的一場 11.20 美元`（附「7/24 群昱物流 · 開了 92 分鐘，中途查了 6 次」）、`本週還能查幾次 還剩 4 次`（附「用完之後會改成較簡單的摘要」） |
| **對應現有** | `apps\web\app\[locale]\spend\page.tsx` → `apps\web\components\spend\SpendDashboard.tsx` |
| **互動元素** | **零**（設計稿的 spend 是純唯讀畫面，沒有任何 `onClick`） |
| **綁定欄位** | `spendRows[].{k,v,pct,color}`、`spendCards[].{k,v,d}` |

**行為差異**：
1. **消失的所有互動**：現有有快捷區間鈕（近 7/30/90 天）、`from`/`to` 日期 input、分組切換 segmented（`GROUP_BY_OPTIONS`）、真 `<table>` 明細（分組鍵/呼叫次數/輸入 tok/輸出 tok/稅前/含稅/佔比＋`<tfoot>` 合計）、「▸ 查看逐筆 AI 呼叫明細」展開的第二張表（時間/項目/模型/tokens/reasoning/cached/重試/稅前/含稅/會議 id）＋分頁。設計稿全部砍掉，只留 5 列橫條圖＋3 張卡。
2. **維度從「AI 呼叫種類」改成「產品功能」**：現有 `byKind` 是 `gemini_text/gemini_extract/gemini_live/openai_image/embedding/asr`（6 個技術值）；設計稿是`開會小幫手/查客戶資料/做簡報/練習對話/臨時幫你查`（5 個功能值）。→ **需要新的映射層**（見 §D1 #11）。
3. **新增「這個月上限 300」＋進度條＋「月底大約 183 美元」預測**——後端**完全沒有 budget/cap 概念**（見 §D1 #10）。
4. **新增「平均一場會議 / 最貴的一場」**——需要 per-meeting 聚合（後端有 `meeting_id` 欄但 `rollup` 只 GROUP BY kind，見 §D1 #9）。
5. **新增「本週還能查幾次」**——deep research 配額目前是 per-meeting 記憶體計數，無「週」概念、無持久化（見 §D1 #12）。
6. **tokens 完全不顯示**（現有 KPI 有「總 tokens」＋輸入/輸出細項）。**含稅/稅前的區分也消失**（設計稿只顯示一個金額）。
7. 現有此頁 `adminOnly`；設計稿沒有權限提示。

---

### B11. 團隊成員 Team（行 961–990）

| 項目 | 內容 |
|---|---|
| **行號** | `sc-if isTeam` 行 961–990 |
| **版面** | `main` `padding:30px 36px 48px`、**`max-width:1100px`**、flex column gap 20px：<br>① header：kicker「團隊成員 · 睿智科技」＋h1 29px「6 位成員 · 2 位還沒接受邀請」＋右側 primary「邀請成員」40px<br>② **4 欄 grid 表格**（14px 圓角、`--panel` 底） |
| **表格**（970–988） | grid `minmax(0,1.6fr) 120px minmax(0,1fr) 120px`；表頭 mono 10px/.1em/mute：**成員 ｜ 權限 ｜ 最近做了什麼 ｜ 狀態**<br>每列：28px avatar（mono 10.5px）＋名 14px/500＋mail mono 10.5px ｜ 權限 tag（mono 11px、5px 圓角、`--line` 框） ｜ 活動 13px/dim ｜ 狀態 mono 11px（`使用中`→ok／`還沒接受`→warn） |
| **6 位成員**（1442–1449） | 角色值：`管理者(acc) / 副管理者(acc) / 成員(dim) ×3 / 只能看(dim)`；狀態：4 位`使用中`、2 位`還沒接受` |
| **對應現有** | `apps\web\app\[locale]\settings\team\page.tsx` → `apps\web\components\settings\TeamSettingsView.tsx` |
| **互動元素** | 「邀請成員」（未綁 onClick）；**每列無任何互動** |
| **綁定欄位** | `members[].{ini,name,mail,role,roleColor,act,status,stColor}` |

**行為差異**：
1. **成員與待邀請合併成一張表**。現有是**兩個 `<section>`**：「成員(n)」`ul.mc-memberlist` ＋「待接受邀請(n)」`ul.mc-invitelist`。設計稿用「狀態」欄（`使用中`/`還沒接受`）合併。→ 後端**沒有合併形狀**，需前端合併兩個 endpoint（見 §D1 #15）。
2. **新增「最近做了什麼」欄**（「剛剛 · Acme 會議」「2 小時前 · 客戶資料」「昨天 · 練習 82 分」「3 天前 · 做簡報」）——後端 `OrgMember` **只有 `createdAt`**，無 `lastActiveAt`／活動摘要（見 §D1 #14）。
3. **角色多出第 4 個值「只能看」**（viewer/read-only）。後端 `Role` 只有 `owner|admin|member` 3 值（`packages\crm\src\ports.ts:91`）。→ **契約變更**。
   對應猜測：`管理者`=owner、`副管理者`=admin、`成員`=member、`只能看`=**新角色**。
4. **消失的所有管理操作**：現有每列有**角色 select**（owner 才能指派 owner/admin，owner 列對非 owner 鎖定）＋「移除」鈕（`window.confirm`）；邀請列有「撤銷」鈕；`InviteForm`（email input＋角色 select＋建立邀請＋成功後可複製連結）。設計稿只有一顆未綁定的「邀請成員」。→ **必須保留**。
5. 現有 `/settings` 只做 server redirect 到 `/settings/team`；設計稿沒有 settings 概念（沒有其他設定頁）。

---

### B12. 設計稿**沒有**的現有畫面（缺口清單）

| 現有 route | 現有元件 | 設計稿狀態 | 影響 |
|---|---|---|---|
| `/login`、`/register` | `apps\web\components\auth\AuthForm.tsx`＋`GoogleSignInButton.tsx` | **完全沒有** | 需自行以新 token 重繪。現況是 `mc-authpage`/`mc-authcard` 單卡＋純 Google 登入（帳密 UI 已於 2026-07-29 移除）。深色卡在淺色主題下會很醜，**必須處理**。 |
| `/invite?token=` | `InviteAcceptView.tsx`（5 個 phase） | **完全沒有** | 同上，沿用 authcard 樣式。 |
| `/sim`（會議模擬器） | `MeetingSimulator.tsx` | **完全沒有**（連 nav 都沒有） | 這是端到端測試工具（灌 mp3 驗 I1/I2）。設計稿的 nav 沒有「測試」群組 → **需確認是否刻意下架**。其樣式幾乎全 inline，受主題影響小。 |
| `/studio`（deck 清單） | `StudioView.tsx`＋`DeckWizard.tsx` | **沒有**（只畫了編輯器） | deck 卡片牆、「＋ 新建簡報」、「📄 從檔案匯入」、3 步生成精靈全無設計。可沿用 `/present/start` 的 deck 列表視覺。 |
| `/train` 通話中 | `TrainCall.tsx` | **沒有** | 計時器/波形/字幕/語速拉桿/掛斷。 |
| `/train` 評分報告 | `ScoreReport.tsx` | **只有摘要卡** | 完整報告頁（highlight 卡、逐字稿）無設計。 |
| `/crm/[id]` 的 4 個 tab 內容 | `ContactsTab/ProductsTab/SocialTab/NotesTab` | **只有 tab 標籤** | 5 個 tab 只畫了 overview。 |
| `/crm` 新增公司表單 | `NewCompanyForm`（in `CompanyListView.tsx`） | 只有按鈕 | |
| 共用 UI 元件 | `apps\web\components\ui\*`（12 個：Toast/ConfirmDialog/EmptyState/Spinner/StateBoundary/StatusBadge/ConfidenceBadge/ProvenanceBadge/JobProgressCard/Markdown/InlineText/) | **完全沒有** | toast、空態、錯誤態、骨架屏、確認對話框、job 進度卡都沒有新設計。**這是最大的實作盲區**——每個畫面的 loading/error/empty 三態都要自行推導。 |
| `/present` 的例外態 | `PresentStage.tsx`（載入中／failedTitle／連線中斷／等待報告者／無 deckId 死路） | **沒有** | |
| 桌機以下的 RWD | `globals.css:527-599`（≤880px drawer） | **沒有任何 `@media`** | 設計稿是純桌機（copilot/studio 甚至 `min-width:1120px`）。 |

---

## C. DynamicSlide 模板陳列室（★ 最重要）

**位置**：Studio 中欄畫布內的 16 個 `sc-if isT1..isT16`（行 **565–795**），畫布尺寸固定 **820×461px**（≈16:9）。
**選擇器**：行 797–815 的橫向模板條（`templates` 陣列，行 1334–1359）——每顆卡有 mini 彩條預覽、群組 tag、「AI 可填」標記、名稱。
**群組分類**（行 1353）：`數據 / 文字 / 圖表 / 圖像`（`圖表`→acc 色、`圖像`→warn 色、其餘 mute）。

> **重要前提**：設計稿的 16 個模板全部**硬寫在 `sc-if` 裡、各自綁不同的資料鍵**（`kpis`/`beforeList`/`weeks`/…），
> 不是「一個模板吃通用 blocks」。而現有系統是 **`template`（6 個排版）× `blocks[]`（10 種型別）** 的二維組合。
> 所以映射時要分辨：**哪些能用現有 `template + blocks` 表達（＝換皮）、哪些需要新 block 型別或新 template**。
> 現有 block 型別（`packages\shared\src\slide-spec.ts:77-90`）：
> `heading / subheading / bullets / paragraph / quote / stat / features / chart(bar|donut|line) / image / two-col`
> 現有 template（`slide-spec.ts:93`）：`title / content / section / stats / image-full / closing`

### 模板總表（先看全貌）

| # | 識別名（kebab-case） | 設計稿名稱 | 群組 | 行號 | 現有映射 | 判定 |
|---|---|---|---|---|---|---|
| T1 | `kpi-cards-3` | 三個大數字 | 數據 | 566–578 | `stats` ＋ 3×`stat` | **換皮**（需 heading/eyebrow 同頁支援，已支援） |
| T2 | `before-after` | 現在 → 之後 | 文字 | 581–597 | `content` ＋ `two-col` | **半新**：需「左右對比＋箭頭＋各自 eyebrow/標題/✕✓ 清單」的排版 |
| T3 | `timeline-gantt` | 時間表 | 數據 | 600–624 | 無 | **全新**（需新 block） |
| T4 | `pull-quote-dark` | 一句客戶原話 | 文字 | 627–637 | `content`/`section` ＋ `quote` | **換皮**（但需「反底深色頁」變體） |
| T5 | `grouped-bar-compare` | 柱狀圖 | 圖表 | 640–657 | `chart(bar)` — **單序列** | **半新**：現有 chart 只吃單一 `series`，這是**雙序列成對比較** |
| T6 | `comparison-matrix` | 方案比較表 | 數據 | 660–667 | 無 | **全新**（需 table block） |
| T7 | `image-full-caption` | 整頁大圖 | 圖像 | 670–677 | `image-full` ＋ `image` | **換皮＋**（需底部漸層字幕層：eyebrow＋標題＋說明疊在圖上） |
| T8 | `steps-4` | 流程四步 | 文字 | 680–692 | 近似 `features`（無編號、無 who） | **半新**：需編號、頂色條、負責人欄 |
| T9 | `feature-cards-3` | 圖示三欄 | 文字 | 697–708 | `content` ＋ `features` | **換皮**（現有 features 是 2 欄 grid，3 個時 flex 換行；設計稿是固定 3 欄） |
| T10 | `donut-breakdown` | 圓環比例圖 | 圖表 | 711–728 | `chart(donut)` | **換皮**（現有 donut 已有 legend；設計稿多了圓心中央大數字＋標籤） |
| T11 | `trend-columns` | 折線趨勢 | 圖表 | 731–745 | `chart(line)` | **半新**：設計稿其實是**細柱狀＋頂端數值標籤**，不是折線 |
| T12 | `bullet-highlights` | 重點項目 | 文字 | 748–758 | `content` ＋ `bullets` | **換皮**（bullet 17px、圓點 acc、置中垂直分佈） |
| T13 | `paragraph-explainer` | 一段說明文字 | 文字 | 761–765 | `content` ＋ `paragraph` | **換皮**（垂直置中、max-width 640px） |
| T14 | `image-left-text-right` | 左圖右文 | 圖像 | 768–779 | `two-col`（`image` + blocks） | **換皮**（需 50/50 滿版分割，非 padding 內的 two-col） |
| T15 | `hero-single-stat` | 單一大數字 | 數據 | 782–787 | `stats` ＋ 1×`stat` | **換皮**（96px 巨數字、accSoft 滿底、置中） |
| T16 | `cover-title` | 封面 | 文字 | 790–794 | `title` | **換皮**（左側 6px acc 粗條、日期 eyebrow、副標人名列） |
| T17 | `three-col-rule` | （無名，僅舞台使用） | — | 399–410 | 近似 `stats` 但版式不同 | **半新**：3 欄各含 mono 標籤/值/說明，欄頂 2px 實線 |

**統計**：16 個陳列模板 ＋ 1 個舞台專用版式 ＝ **17 個版式**。
- **換皮 10 個**：T1 / T4 / T7 / T9 / T10 / T12 / T13 / T14 / T15 / T16（其中 T4 需「反底頁」變體、T7 需底部字幕層、T14 需滿版分割）
- **半新 5 個**：T2 / T5 / T8 / T11 / T17（現有 blocks 表達不完整，需擴充欄位或新 template）
- **全新 2 個**：T3 `timeline-gantt`、T6 `comparison-matrix`（現有 blocks 完全無法表達，需新 block 型別）

---

### C1. `kpi-cards-3`（三個大數字）— 行 566–578

**版面**：`padding:32px 36px`、flex column gap 16px
- eyebrow：mono 11px/.18em/`--warn`「導入後的三個數字」
- h2：29px/600/-.02em/line-height 1.2
- **3 欄 grid** `repeat(3,1fr)` gap 14px、`flex:1`、`align-items:stretch`；每格 `justify-content:flex-end`（內容貼底）、14px padding、10px 圓角、底色可變（`k.bg`）：
  - 值 **42px/700/-.03em/line-height 1**（色 `k.fg`）
  - 標籤 14px/600（色 `k.fg`）
  - 說明 12px/1.5/`--dim`

**內容槽位**：eyebrow(1) ＋ 標題(1) ＋ **3 項** × {`v` 值, `k` 標籤, `d` 說明, `bg` 底色, `fg` 前景色}
（資料：行 1360–1364，第一項 `--accSoft`/`--acc`，其餘 `--sunk`/`--ink`——**第一項強調**）

**現有映射**：`template:"stats"` ＋ `[heading, stat, stat, stat]`（`eyebrow` 用 `SlideSpec.eyebrow`）。
`studio-present.css:214-234` 的 `.slide--stats` 已支援：body 轉 row/wrap、heading `flex-basis:100%`、`stat` 卡有 `--slide-surface` 底＋框、`stat__value` 11cqw（首項 12.5cqw）。
→ **既有模板的新皮**。差異：現有首項只是「字更大」，設計稿是「首項換底色」；現有無 per-stat 說明文字（`stat` 只有 `value`+`label`）。
**需新增槽位**：`stat` block 加選填 `desc?: string`（否則第三行說明無處可放）。

**會中／會前**：**極適合會中**。3 個數字＋一句話，生成快、資訊密度高、對「他們問成效」的即時補頁最有用。

---

### C2. `before-after`（現在 → 之後）— 行 581–597

**版面**：`flex:1` **3 欄 grid** `1fr 52px 1fr`（滿版、無外 padding）
- 左格：底 `--sunk`、`padding:30px 28px`、gap 11px
  - eyebrow mono 11px/.16em/`--mute`「他們現在的狀況」
  - h3 23px/600/1.3
  - `sc-for beforeList` 每項 flex gap 8px、14px/1.5/`--dim`，前置 `✕`（色 `--live`）
- 中格 52px：置中 20px `→`（色 `--acc`）
- 右格：底 **`--accSoft`**、同 padding
  - eyebrow mono 11px/.16em/**`--acc`**「換完之後」
  - h3 23px/600/1.3
  - `sc-for afterList` 每項前置 `✓`（色 `--ok`），文字不 dim

**內容槽位**：左 {eyebrow, 標題, N 項清單}、右 {eyebrow, 標題, N 項清單}、中間箭頭（固定）
（資料：`beforeList` 3 項、`afterList` 3 項，行 1365–1366）

**現有映射**：`template:"content"` ＋ `[two-col{left:[subheading,bullets], right:[subheading,bullets]}]`。
`studio-present.css:170` 的 `.slide-block--two-col` 是 `1fr 1fr` gap 3cqw，**在 `.slide__body` 的 padding 內**，沒有滿版分割底色、沒有中間箭頭欄、bullet 前綴是統一的 `::before` 圓點（`css:113-121`）不是 ✕/✓。
→ **半新**。可用現有 blocks 表達內容，但**需要新的 template 排版**（建議 `template:"before-after"`），以及：
- `two-col` 需支援 per-column 背景/強調（或由新 template 的 CSS 依 `:first-child`/`:last-child` 決定）
- `bullets` 需支援 marker 變體（`✕` 負向／`✓` 正向）→ 建議 `bullets` 加 `marker?: "dot"|"check"|"cross"`

**會中／會前**：**會中可用**（「他們抱怨現況」時對比補頁），但需要 6 條文字，生成成本中等。偏會前。

---

### C3. `timeline-gantt`（時間表）— 行 600–624 ★ 全新

**版面**：`padding:30px 36px`、flex column gap 18px
- 標題列：h2 26px/600/-.02em ＋ 同行 baseline 對齊的 mono 11px/`--mute` 註記
- **週刻度**：`repeat(6,1fr)` grid gap 6px；`sc-for weeks` 每格 column gap 6px：
  - 7px 高色條（4px 圓角，色 `w.color`）
  - mono 10.5px/`--mute` 週次
  - 12.5px/600/1.35 標題
- **軌道區**：`flex:1` flex column gap 8px、`justify-content:center`；`sc-for tracks` 每列 **2 欄 grid** `112px 1fr`：
  - 12.5px/`--dim` 軌道名
  - `position:relative` 22px 高槽（6px 圓角、`--sunk` 底、`overflow:hidden`），內含 `position:absolute` 的條（`left:{{tk.left}}`、`width:{{tk.w}}`、色 `tk.color`）

**內容槽位**：標題(1) ＋ 註記(1) ＋ **N 個時間刻度** × {`n` 名稱, `t` 標題, `color`} ＋ **M 條軌道** × {`k` 名稱, `left` 起點%, `w` 寬度%, `color`}
（資料：`weeks` 6 項行 1367–1371、`tracks` 3 項行 1372–1376）

**現有映射**：**無任何對應**。`chart` 只有 bar/donut/line 三種、只吃 `{label, value}` 序列，無法表達「起點＋長度」的區間。
→ **全新模板**。需要：
- **新 block 型別 `timeline`**：
  ```ts
  | { type: "timeline";
      ticks: { name: string; title?: string; emphasis?: "on"|"warn"|"off" }[];
      tracks: { label: string; startPct: number; widthPct: number; emphasis?: "on"|"warn"|"off" }[] }
  ```
  （用 `emphasis` 語意色而非 hex，才能吃 `--slide-accent` 主題）
- **新 template `timeline`**（或掛在 `content` 下由 block 自撐版面）
- pptx 匯出也要新增對應（`apps\server` 的 pptx exporter 需處理）

**會中／會前**：**會前為主**。時程資料通常會前就備好；會中要生成正確的 left/width 百分比對 LLM 是高風險（易錯位）。
但「對方問什麼時候能上線」是設計稿裡明示的會中場景（行 1010 checklist `c4`、行 852 的自動補頁範例），所以**會中也需要**——建議會中生成時限制成「等分刻度＋整段軌道」的簡化子集。

---

### C4. `pull-quote-dark`（一句客戶原話）— 行 627–637

**版面**：`padding:42px 46px`、flex column、`justify-content:center`、gap 20px、**底色 `var(--ink)`（反底！）**
- eyebrow mono 11px/.18em/`--warn`「客戶原話」
- 引言 **30px/600/1.42/-.02em**、色 **`var(--panel)`**（反白）、`text-wrap:pretty`，含全形引號「」
- 署名列：34px 圓角方（11px 圓角、底 `--warn`、字色 `--ink`、13px/700、單字）＋ 兩行（14px/600 姓名·職稱 色 `--panel` ／ 12.5px 公司·年份 色 `--mute`）

**內容槽位**：eyebrow(1) ＋ 引言(1) ＋ 署名 {首字 avatar, 姓名·職稱, 公司·背景}
（**這頁的內容全是硬寫的**，沒有 `sc-for`／`{{ }}` 綁定——行 628–635 是 literal 文字）

**現有映射**：`template:"content"` 或 `"section"` ＋ `[quote{text, attribution}]`。
`studio-present.css:124-132`：`.slide-block--quote` 是 `font-size:3.4cqw`、左框 0.4cqw `--slide-accent`、`cite` 2cqw/muted。
→ **既有模板的新皮**，但需要兩個新東西：
1. **反底（inverted）頁變體**——現有沒有「整頁用 `--ink` 當底、`--panel` 當字」的機制。可用 `SlideTheme.bg/text` 覆寫達成（生成時把 `theme.bg = ink 值`），但這會**破壞「新頁繼承 anchor theme」的一致性規則**（`slide-spec.ts:15`）。建議改為 **template 層的 `quote` 變體**（CSS 反轉），不動 theme。
2. `quote` 的 `attribution` 目前是單一字串；設計稿要 3 段（avatar 首字可從姓名推導、姓名·職稱、公司·年份）。建議 `attribution` 保持字串但 CSS 拆行，或加 `attributionMeta?: string`。

**會中／會前**：**會中極適合**。單一句引言＋署名，生成成本最低、視覺衝擊最大，很適合「他們懷疑成效」時即時補一則客戶原話（前提：CRM/案例庫有可引用的原話）。

---

### C5. `grouped-bar-compare`（柱狀圖）— 行 640–657

**版面**：`padding:30px 36px`、flex column gap 14px
- 標題列（`flex-wrap`, baseline）：h2 25px/600 ＋ mono 10.5px/`--mute` 單位說明「換之前 → 換之後（百萬 / 年）」
- 圖區：`flex:1` flex row gap **24px**、`align-items:flex-end`、`border-bottom:1px solid var(--line)`；`sc-for bars` 每組 `flex:1` column 置中 gap 8px：
  - **成對雙柱**：172px 高容器內兩根 36px 寬柱（gap 10px），第一根 `--sunk` 底（值字 `--dim`），第二根 `--acc` 底（值字 `--accInk`）；**值標在柱內頂端**（mono 11px、`padding-top:4px`）
  - 組名 13px/600
  - 變化量 mono 11px/`--ok`（「省 9%」）

**內容槽位**：標題(1) ＋ 單位說明(1) ＋ **N 組** × {`k` 組名, `v1`/`h1` 前值+高度, `v2`/`h2` 後值+高度, `d` 變化標註}
（資料：`bars` 3 項，行 1377–1381）

**現有映射**：`chart{chartType:"bar", series:[{label,value}], caption}`。
`studio-present.css:177-181`：現有 bar chart 是**單序列**（每個 label 一根柱、值標在柱**上方**、柱用 accent 漸層）。
→ **半新**。需要：
- **`chart` 支援多序列**：`series2?: ChartPoint[]` 或改 `series: { label: string; values: number[] }[]` ＋ `seriesNames?: string[]`。
  （註：`CHART_ACCENT_HUES`（`slide-spec.ts:63`）已為多序列預留了色，但 `ChartPoint` 只有單值——契約已有意圖、未實作。）
- **per-group delta 標註**（「省 9%」）：新增 `deltas?: string[]` 或每點加 `note?: string`
- 高度目前設計稿是硬寫 px（`h1:"120px"`），實作要改成由 value 正規化

**會中／會前**：**會前為主**。需要 6 個數字＋3 個變化率，且要有真實比較基準；會中憑逐字稿生成數字有幻覺風險（**應禁止會中憑空生成數值圖表**，只能引用已驗證的案例數據）。

---

### C6. `comparison-matrix`（方案比較表）— 行 660–667 ★ 全新

**版面**：`padding:28px 32px`、flex column gap 12px
- h2 24px/600/-.02em
- **矩陣 grid**：`flex:1`、`grid-template-columns:minmax(0,1.6fr) 1fr 1fr 1fr`、`grid-auto-rows:1fr`（**等高列**）、外框 1px `--line`、9px 圓角、`overflow:hidden`
- `sc-for matrix` 攤平的 **20 個 cell**（4 欄 × 5 列），每格：`padding:0 11px`、`align-items:center`、右/下 1px `--line2` 邊框，每格自帶 `bg`/`font`/`size`/`weight`/`fg`

**cell 樣式規則**（行 1382–1401 的 `matrix` IIFE）：
- 表頭列（`ri===0`）：底 `--sunk`、字 `--dim`、mono、**11px**、600
- 「我們」欄（`ci===1` 且非表頭）：底 **`--accSoft`**、字 `--acc`、mono、13px、600 ← **自家欄整欄高亮**
- 首欄（`ci===0` 且非表頭）：字 `--dim`、**繼承字體（非 mono）**、13px、400
- 其他：字 `--ink`、mono、13px、400

**實際內容**（行 1383–1389）：
| （空） | 我們 | Oracle | 自己開發 |
|---|---|---|---|
| 多久能上線 | 6 週 | 5–7 個月 | 看人力 |
| 接現有系統 | 現成的接法 | 要客製 | 全部自己寫 |
| 各廠同步 | 15 分鐘一次 | 每天一次 | 要另外做 |
| 第一年費用 | 168 萬 | 約 400 萬 | 難估 |

**內容槽位**：標題(1) ＋ **表頭 N 欄**（第一格為空）＋ **M 列** × N 格文字 ＋ **highlightColumn 索引**

**現有映射**：**無任何對應**。`two-col` 只有兩欄且是 block 容器；`bullets` 是一維。
→ **全新模板**。需要：
- **新 block 型別 `table`**：
  ```ts
  | { type: "table";
      headers: string[];              // 第一格通常為空字串
      rows: string[][];               // 每列長度 = headers.length
      highlightColumn?: number }      // 自家方案欄（吃 accSoft/acc）
  ```
- **新 template `matrix`**（或掛 `content`）
- pptx 匯出需新增 table 支援
- 生成 guard：`rows[i].length === headers.length`，欄數上限（建議 ≤4 欄、≤6 列，超出版面會爆）

**會中／會前**：**會中極有價值但風險最高**。設計稿的會中場景（「他們說在比 Oracle」，行 1002/1282「還在比較誰」）正需要即時比較表；但表格內容是**競品事實斷言**，幻覺代價高（會當眾說錯競品規格）。
→ 建議：會中只允許從**已驗證的 battlecard 資料**（`INTEL_US` 類）填表，禁止 LLM 自由生成競品欄。

---

### C7. `image-full-caption`（整頁大圖）— 行 670–677

**版面**：`flex:1`、`position:relative`、flex column、`justify-content:flex-end`
- 背景：`repeating-linear-gradient(135deg, var(--sunk) 0 14px, var(--panel2) 14px 28px)`（**斜紋佔位**，代表待放圖）
- 左上角絕對定位 mono 10.5px/`--mute` 提示「［ 放產線照片 · 建議 1600×900 ］」
- 底部字幕層：`padding:26px 32px`、`background:linear-gradient(to top, var(--panel) 64%, transparent)`：
  - eyebrow mono 11px/.16em/`--warn`「台中一廠 · 先試一條線」
  - h2 30px/600/-.02em/1.2
  - 說明 14.5px/`--dim`/`max-width:520px`

**內容槽位**：圖片(1) ＋ eyebrow(1) ＋ 標題(1) ＋ 說明(1) ＋（設計稿提供尺寸建議文字）

**現有映射**：`template:"image-full"` ＋ `[image]`。
`studio-present.css:242-249`：`.slide--image-full` 的 body 在有 image 時 `padding:0; gap:0`，圖 `object-fit:cover` 滿版；**沒有字幕層**。無 image 時退回 radial-gradient 佔位。
→ **既有模板的新皮＋**。需要：
- **`image-full` 支援與 image 併存的文字層**：目前 `slide--image-full .slide__body:has(.slide-block--image) { padding:0 }` 會讓任何同頁文字貼邊。需加「底部漸層字幕區」的 CSS（把 eyebrow/heading/paragraph 包進 overlay）。
- 佔位態的「建議尺寸」提示文字——現有無此 UX。
- ⚠ `AI_GENERATION_TEMPLATES`（`slide-spec.ts:101`）**刻意排除 `image-full`**（因 AI 不生 image block）。若新版 `image-full` 允許「純文字＋斜紋佔位」，這條排除規則要重新評估。

**會中／會前**：**會前專屬**。會中沒有圖片來源（生圖走 OpenAI `gpt-image-2`，成本＋延遲都不可接受於會中）。

---

### C8. `steps-4`（流程四步）— 行 680–692

**版面**：`padding:30px 36px`、flex column gap 16px
- h2 26px/600/-.02em「接下來四步」
- `flex:1` flex row gap 10px；`sc-for steps` 每格 `flex:1` column gap 9px、`padding:14px 13px`、**`border-top:3px solid {{sp.color}}`**、底色 `sp.bg`（**無圓角**）：
  - 編號 mono **21px/600**（色 `sp.color`）
  - 標題 14.5px/600/1.35
  - 說明 12.5px/1.5/`--dim`
  - **`margin-top:auto`** 的負責人 mono 10.5px/`--mute`（貼底對齊）

**內容槽位**：標題(1) ＋ **N 步** × {`n` 編號, `t` 標題, `d` 說明, `who` 負責人/時間, `color` 頂條色, `bg` 底色}
（資料：`steps` 4 項，行 1402–1407；色由 acc→acc→warn→line 遞減，bg 由 accSoft→transparent→warnSoft→transparent 交錯）

**現有映射**：最接近 `content` ＋ `features`（每項 icon/title/desc）。
`studio-present.css:136-153`：`.slide-block--features` 是 **2 欄 grid**（3 個時 flex 換行 50%），每項有 icon 方塊＋title 15px＋desc 1.95cqw（`-webkit-line-clamp:2`）。
→ **半新**。差異：
- 設計稿是**橫向 N 欄等分**（不是 2 欄 grid），有**序號**、**頂部色條**、**第四行負責人**、**無 icon**
**建議**：新 block 型別 `steps`
```ts
| { type: "steps"; steps: { title: string; desc?: string; owner?: string }[] }
```
（編號由渲染器自動生成 `01/02/…`；色階由渲染器依 index 從 `--slide-accent` 衍生，不寫 hex）
或者：`features` 加 `owner?: string` ＋ `template:"steps"` 控制橫排＋序號。**前者較乾淨**。

**會中／會前**：**會中極適合**。「下一步是什麼」是每場會的收尾（設計稿 checklist `c7`「約好下次技術討論的時間」），4 個短欄位、生成快、且內容多半來自會中共識。

---

### C9. `feature-cards-3`（圖示三欄）— 行 697–708

**版面**：`padding:30px 36px`、flex column gap 16px
- h2 26px/600/-.02em「為什麼選我們」
- `flex:1` **3 欄 grid** `repeat(3,1fr)` gap 14px；每格 column gap 9px、`padding:16px 14px`、1px `--line` 框、10px 圓角、底色 `f.bg`（**中間那格用 `--accSoft` 強調**）：
  - 34×34 圖示方塊（10px 圓角、底 `--accSoft`、字 `--acc`、16px 字符）
  - 標題 15px/600/1.35
  - 說明 12.5px/1.55/`--dim`

**內容槽位**：標題(1) ＋ **3 項** × {`glyph` 圖示, `t` 標題, `d` 說明, `bg` 底色}
（資料：`feats` 3 項，行 1316–1320；glyph 用 `◈ ◉ ◆` 幾何字符）

**現有映射**：`template:"content"` ＋ `[heading, features]`。**最接近既有能力**。
差異：現有 features 是 2 欄 grid（3 個時 50% flex 換行）；設計稿固定 3 欄。現有 icon 是 `SLIDE_ICONS` 白名單的 inline SVG（`slide-spec.ts:31-35`，22 個 Lucide 風格）；設計稿用幾何字符（`◈◉◆`）。
→ **既有模板的新皮**。建議：`features` 加 `columns?: 2|3` 或由 `feat-count-3` CSS 改成 3 欄；**icon 繼續用現有 SVG 白名單**（比字符可控、跨平台安全），設計稿的字符視為佔位。

**會中／會前**：**會中適合**。3 個要點是最常見的即時補頁形狀。

---

### C10. `donut-breakdown`（圓環比例圖）— 行 711–728

**版面**：`padding:30px 36px`、flex **row** gap 28px、`align-items:center`
- 左：190×190 圓（`border-radius:50%`、底 `conic-gradient(...)`）內嵌 118×118 白圓（`--panel`）：
  - 中央 26px/700/-.02em 大數字「240 萬」
  - 下方 11.5px/`--dim`「一年可省」
- 右：`flex:1` column gap 12px
  - h2 24px/600/-.02em
  - `sc-for donutRows` 每列 flex gap 10px：11×11 色塊（3px 圓角）＋ 名稱 13.5px（`flex:1`）＋ mono 13px/`--dim` 值

**donut 漸層**（行 1321）：`conic-gradient(var(--acc) 0 42%, var(--warn) 42% 68%, var(--ok) 68% 86%, var(--line) 86% 100%)`
**內容槽位**：中央大數字(1) ＋ 中央標籤(1) ＋ 標題(1) ＋ **N 列** × {`k` 名稱, `v` 值, `c` 顏色}
（資料：`donutRows` 4 項，行 1322–1327）

**現有映射**：`chart{chartType:"donut", series, caption}`。
`studio-present.css:184-189`：現有 donut 有 `chart__donut-hole`（透明中孔＋hairline 描邊）＋ legend（label/val）。
→ **既有模板的新皮**。需要：
- **中孔內的大數字＋標籤**：目前中孔是空的。可用 `chart.caption` 放大數字？語意不對——建議 `chart` 加 `centerValue?: string; centerLabel?: string`（只對 donut 有意義）。
- 色：設計稿用 acc/warn/ok/line 4 個語意色；現有用 `--slide-accent` ＋ `CHART_ACCENT_HUES` 衍生。→ 保留現有衍生機制（吃主題），不照抄 warn/ok。

**會中／會前**：**會中可用**（「省下來的錢從哪來」），但需要 4 個金額加總正確——有算術風險。中等優先。

---

### C11. `trend-columns`（折線趨勢）— 行 731–745

**版面**：`padding:30px 36px`、flex column gap 14px
- 標題列（baseline, `flex-wrap`）：h2 25px/600 ＋ mono 10.5px/`--mute` 資料來源註「永豐機械實際數字」
- 圖區：`flex:1` flex row gap **0**、`align-items:flex-end`、`border-bottom` ＋ **`border-left`** 各 1px `--line`、`padding:0 4px`；`sc-for lineCols` 每格 `flex:1` `height:100%` column `justify-content:flex-end` 置中 gap 6px：
  - 值 mono 11px/`--dim`（**在柱頂上方**）
  - **5px 寬**細柱（`border-radius:3px 3px 0 0`、`--acc`、`height:{{p.h}}`）
  - X 軸標籤 mono 10.5px/`--mute`

**內容槽位**：標題(1) ＋ 來源註(1) ＋ **N 點** × {`k` X 標籤, `v` 顯示值, `h` 高度}
（資料：`lineCols` 6 項，行 1328–1331，1–6 月 91%→99%）

**現有映射**：`chart{chartType:"line", series}`。
`studio-present.css:192-195`：現有 line 是真 SVG 折線（`line-path` ＋ `line-area` 填充 ＋ `line-dot`）＋ 底部 X 標籤列。
→ **半新**。**設計稿名為「折線趨勢」但實際畫的是細柱狀圖**（5px 寬柱、無連線、無面積）。兩種選擇：
1. 沿用現有 SVG 折線（更符合「折線」語意），只換色/字級 → **換皮**
2. 照設計稿做細柱變體 → 需 `chart` 加 `variant?: "line"|"column"` 或新 chartType `"column"`（會影響 `CHART_TYPES` 常數＋server Gemini enum＋pptx typeMap，`slide-spec.ts:52`）
**建議**：先按 (1) 換皮，把設計稿的細柱視為視覺參考。若使用者堅持細柱樣式，再走 (2)。
另需：**每點顯示數值標籤**（現有 line 只在 X 軸有標籤，無 per-point 值）。

**會中／會前**：**會前為主**（同 C5，會中生成數列有幻覺風險）。

---

### C12. `bullet-highlights`（重點項目）— 行 748–758

**版面**：`padding:34px 40px`、flex column gap 16px
- eyebrow mono 11px/.18em/`--warn`「這場會議的重點」
- h2 28px/600/-.02em
- `flex:1` flex column gap 11px、**`justify-content:center`**；`sc-for bulletList` 每項 flex gap 12px、`align-items:baseline`、**17px/1.5**，前置 7×7 圓點（`border-radius:50%`、`--acc`）

**內容槽位**：eyebrow(1) ＋ 標題(1) ＋ **N 條**（純字串）
（資料：`bulletList` 4 項，行 1332）

**現有映射**：`template:"content"` ＋ `[heading, bullets]`。
`studio-present.css:102-121`：現有 bullets 有 `::before` 圓點（`--slide-accent`）、`padding-left:2.6cqw`。
→ **既有模板的新皮**（最直接）。差異：垂直置中（現有 content 是 `justify-content:flex-start`，`css:212`）、字級 17px（≈4cqw）比現有大、`heading` 沒有底部 accent 分隔線（現有 `.slide--content .slide-block--heading` 有 `border-bottom:0.28cqw solid --slide-accent`，`css:213`）。

**會中／會前**：**會中最適合的形狀之一**。純文字、4 條、生成最快最穩。應設為會中補頁的**預設模板**。

---

### C13. `paragraph-explainer`（一段說明文字）— 行 761–765

**版面**：`padding:36px 44px`、flex column gap 14px、**`justify-content:center`**
- eyebrow mono 11px/.18em/**`--mute`**（注意：不是 warn）「補充說明」
- h2 27px/600/-.02em/1.25
- 段落 **16px/1.75**/`--dim`/`max-width:640px`/`text-wrap:pretty`

**內容槽位**：eyebrow(1) ＋ 標題(1) ＋ 段落(1)
（**硬寫內容**，行 762–764，無綁定）

**現有映射**：`template:"content"` ＋ `[heading, paragraph]`。
`studio-present.css:123`：`.slide-block--paragraph` 是 2.3cqw/`--slide-text`/1.5。
→ **既有模板的新皮**。差異：垂直置中、行高 1.75（現 1.5）、色 `--dim`（現 `--slide-text`）、max-width 640px。

**會中／會前**：**會中第一順位**。這正是設計稿明示的會中補頁範例（行 763「資安審查為什麼可以縮短」＋行 851–852「對方問到『資安審查要多久』時，小幫手照你的版型補了第 7 頁」）。
一句標題＋一段解釋＝生成最快、最不會出錯、最適合回答臨場問題。**建議與 C12 併列為會中兩大主力模板**。

---

### C14. `image-left-text-right`（左圖右文）— 行 768–779

**版面**：`flex:1` **2 欄 grid** `1fr 1fr`（滿版）
- 左：`position:relative`、`repeating-linear-gradient(135deg, var(--sunk) 0 12px, var(--panel2) 12px 24px)` 斜紋佔位 ＋ 左上絕對定位 mono 10.5px/`--mute`「［ 放系統畫面截圖 ］」
- 右：`padding:32px 30px`、column gap 12px、`justify-content:center`
  - eyebrow mono 11px/.16em/**`--acc`**「實際操作畫面」
  - h2 24px/600/1.3/-.02em
  - `sc-for twoColList` 每項 flex gap 8px、14px/1.55/`--dim`，前置 `—`（色 `--acc`）

**內容槽位**：圖片(1) ＋ eyebrow(1) ＋ 標題(1) ＋ **N 條清單**（`—` 前綴）
（資料：`twoColList` 3 項，行 1333）

**現有映射**：`template:"content"` ＋ `[two-col{left:[image], right:[subheading, bullets]}]`。
→ **既有模板的新皮**，但差異在**滿版 50/50 分割**（現有 `two-col` 在 body padding 內、gap 3cqw）。需新 template（建議 `split`）或 `two-col` 加 `bleed?: boolean`。
bullet marker 是 `—`（同 C2 的 marker 需求）。

**會中／會前**：**會前專屬**（需要圖）。

---

### C15. `hero-single-stat`（單一大數字）— 行 782–787

**版面**：`padding:40px`、flex column、**置中（`align-items:center; justify-content:center`）**、gap 14px、**底色 `--accSoft`（整頁染色）**
- eyebrow mono 11px/**.2em**/`--acc`「最重要的一個數字」
- 值 **96px/700/-.04em/line-height 1**、色 `--ink`
- 標籤 18px/600
- 註 13.5px/`--dim`

**內容槽位**：eyebrow(1) ＋ 值(1) ＋ 標籤(1) ＋ 註腳(1)
（**硬寫**，行 783–786）

**現有映射**：`template:"stats"` ＋ `[stat]`（單一）。
`studio-present.css:232-234`：`.slide--stats .stat__value` 是 11cqw（首項 12.5cqw ≈ 設計稿的 96px/820px ≈ 11.7cqw ✅ 尺度吻合）。
`css:155-165`：`stat__value` 有 `linear-gradient(120deg, accent, accent-2)` 漸層文字。
→ **既有模板的新皮**。差異：整頁 `--accSoft` 染底（現有無）、置中（現有 stats 是 row/wrap left-align）、多一行註腳（`stat` 只有 value+label → 同 C1 的 `desc?` 需求）、值用純 `--ink` 非漸層。
建議：新增 `template:"hero-stat"`（或 `stats` 的單項變體 CSS）。

**會中／會前**：**會中極適合**。一個數字＋三行字，最快、最有衝擊力，適合「他們問成效」時甩出一個關鍵數字。

---

### C16. `cover-title`（封面）— 行 790–794

**版面**：`padding:44px 48px`、flex column、`justify-content:center`、gap 16px、**`border-left:6px solid var(--acc)`**
- eyebrow mono **12px**/.2em/`--warn`「2026 / 07 / 30 · 進度會」
- h1 **46px/700/-.03em/1.12**，含 `<br>` 手動斷行
- 副標 15px/`--dim`「睿智科技 · 陳麥林　|　給 陳志豪 總監、林淑芬 財務長」（全形空白分隔）

**內容槽位**：日期/場合 eyebrow(1) ＋ 主標(1，可多行) ＋ 「誰做的 | 給誰」副標(1)

**現有映射**：`template:"title"` ＋ `[heading, subheading]`。
`studio-present.css:201-208`：`.slide--title` body 垂直置中、heading 8.4cqw/800、`::after` 有 accent 漸層底線、subheading 3cqw/max-80%。
→ **既有模板的新皮**。差異：左側 6px accent 粗條（現有是 heading 下的漸層 `::after`）、字級 46px/820 ≈ 5.6cqw（**比現有 8.4cqw 小很多**）、字重 700（現 800）、副標同一行用全形分隔（現有 subheading 獨立段）。
封面通常有 mesh 漸層背景（`css:38-50` 對 title/section/stats/closing 都加了三層 radial-gradient）；**設計稿的封面沒有任何背景裝飾**——這是明顯的風格轉向（從「漸層 mesh」轉「留白＋色條」）。

**會中／會前**：**會前專屬**（封面不會會中生成）。

---

### C17. `three-col-rule`（舞台專用三欄）— 行 399–410

**版面**（舞台尺度，1120px 寬 16:9，`padding:64px 72px`）：flex column gap 22px
- eyebrow mono **15px**/.16em/`#A9661A`「第 4 頁 · 什麼時候能上線」
- h2 **52px**/600/1.15/-.02em
- **3 欄 grid** `repeat(3,1fr)` gap 20px、`margin-top:8px`；`sc-for slideCols` 每欄 column gap 8px、**`padding-top:16px`＋`border-top:2px solid #15130F`**：
  - mono **14px**/`#5C564C` 期間標籤
  - **30px/600**/-.01em 主內容
  - **16px/1.5**/`#5C564C` 說明

**內容槽位**：eyebrow(1) ＋ 標題(1) ＋ **3 欄** × {`k` 標籤, `v` 主內容, `d` 說明}
（資料：`slideCols` 3 項，行 1253–1257）

**與 C1（`kpi-cards-3`）的差異**（**不是同一個模板**）：
| | C1 `kpi-cards-3` | C17 `three-col-rule` |
|---|---|---|
| 欄的視覺 | 圓角色塊（10px 圓角、底色填充） | 無底色，**欄頂 2px 實線**規則線 |
| 順序 | 值(42px) → 標籤(14px) → 說明(12px) | 標籤(mono 14px) → 值(30px) → 說明(16px) |
| 值的字級 | 42px/700 | 30px/600 |
| 內容性質 | **數字 KPI** | **期間/階段的敘述**（「盤點現況與資料」不是數字） |
| 對齊 | `justify-content:flex-end`（貼底） | 自然由上往下 |

**現有映射**：介於 `stats`（3 個 stat）與 `content`+`two-col` 之間，**都不精確**。
→ **半新**。建議做成 `template:"columns"` ＋ 新 block `columns`：
```ts
| { type: "columns"; columns: { label: string; value: string; desc?: string }[] }
```
（與 `steps` 的差別：無序號、無頂色條、有 rule line、label 在上）
或用現有 `features` 去掉 icon ＋ 加 `label` 槽位。

**會中／會前**：**會中適合**（3 欄敘述式，如「分三階段」）。它是設計稿選來當舞台示範的版式，說明設計者認為這是**代表性的內容頁**。

---

### C18. 模板選擇條的 metadata（實作契約用）

行 1334–1359 的 `templates` 陣列同時定義了每個模板的**選擇器外觀**：

| 索引 | `name` | `group`（行 1353） | mini 預覽（`dir`, `align`, 彩條） |
|---|---|---|---|
| 0 | 三個大數字 | 數據 | row, flex-end, 70%acc / 45%line / 58%line |
| 1 | 現在 → 之後 | 文字 | row, stretch, 100%line / 100%acc |
| 2 | 時間表 | 數據 | column, stretch, 3×5px 條（acc/line/line） |
| 3 | 一句客戶原話 | 文字 | column, stretch, 60%ink / 20%warn |
| 4 | 柱狀圖 | 圖表 | row, flex-end, 40%line / 85%acc / 60%line |
| 5 | 方案比較表 | 數據 | column, stretch, 3×8px 條（line/line/acc） |
| 6 | 整頁大圖 | 圖像 | column, stretch, 70%line / 24%acc |
| 7 | 流程四步 | 文字 | row, stretch, 4 條（line/acc/line/line） |
| 8 | 圖示三欄 | 文字 | row, stretch, 3 條（line/acc/line） |
| 9 | 圓環比例圖 | 圖表 | row, center, 70%acc / 30%line |
| 10 | 折線趨勢 | 圖表 | row, flex-end, 30%line / 55%acc / 85%acc |
| 11 | 重點項目 | 文字 | column, stretch, 3×6px（acc/acc/line） |
| 12 | 一段說明文字 | 文字 | column, stretch, 35%line / 55%acc |
| 13 | 左圖右文 | 圖像 | row, stretch, 100%line / 100%acc |
| 14 | 單一大數字 | 數據 | column, center, 60%acc |
| 15 | 封面 | 文字 | column, stretch, 20%warn / 55%acc |

**「AI 可填」標記**：行 1355 對**所有 16 個**模板都設 `ai: "AI 可填"`（mono 8.5px、`--acc`）。
→ 設計意圖是**全部模板都可由 AI 選用**。但依上表分析，`image-full-caption`(6) 與 `image-left-text-right`(13) 在會中無圖可用；
`grouped-bar-compare`(4)／`trend-columns`(10)／`comparison-matrix`(5) 有數值/事實幻覺風險。
→ **建議實作時把 `ai` 標記拆成三級**：`會中可用 / 會前 AI 可填 / 需人工`（見下節）。

### C19. 會中／會前適用性總結（給 AI 選模板的建議白名單）

| 分級 | 模板 | 理由 |
|---|---|---|
| **★ 會中第一線**（生成快、無數值風險） | `paragraph-explainer`(C13)、`bullet-highlights`(C12)、`pull-quote-dark`(C4)、`hero-single-stat`(C15)、`steps-4`(C8) | 純文字或單一數字，1–4 個槽位，回答臨場問題的主力 |
| **○ 會中次選**（需 3–6 個槽位或簡單數字） | `kpi-cards-3`(C1)、`feature-cards-3`(C9)、`three-col-rule`(C17)、`before-after`(C2) | 生成成本中等，內容多來自會中對話 |
| **△ 會中限制使用**（僅可引用已驗證資料，禁止 LLM 生成數值） | `donut-breakdown`(C10)、`comparison-matrix`(C6)、`timeline-gantt`(C3 簡化子集) | 幻覺代價高（當眾說錯數字/競品規格） |
| **✕ 會前專屬** | `image-full-caption`(C7)、`image-left-text-right`(C14)、`cover-title`(C16)、`grouped-bar-compare`(C5)、`trend-columns`(C11) | 需圖片來源，或需真實多序列數據 |

### C20. 需新增的 contract（彙總，供凍結契約用）

**新 block 型別（3 個必要）**：
```ts
| { type: "table"; headers: string[]; rows: string[][]; highlightColumn?: number }        // C6 全新
| { type: "timeline"; ticks: {...}[]; tracks: {...}[] }                                   // C3 全新
| { type: "steps"; steps: { title: string; desc?: string; owner?: string }[] }            // C8 半新
| { type: "columns"; columns: { label: string; value: string; desc?: string }[] }         // C17 半新（可選，或用 features 擴充）
```

**既有 block 需擴充的槽位**：
| block | 新增欄位 | 為了 |
|---|---|---|
| `stat` | `desc?: string` | C1 每格第三行說明、C15 註腳 |
| `bullets` | `marker?: "dot"\|"check"\|"cross"\|"dash"` | C2 的 ✕/✓、C14 的 — |
| `chart` | `series2?: ChartPoint[]` ＋ `seriesNames?: string[]` | C5 雙序列成對比較（`CHART_ACCENT_HUES` 已預留色） |
| `chart` | `centerValue?: string; centerLabel?: string` | C10 donut 中孔大數字 |
| `chart` | 每點 `note?: string`（或 `deltas?: string[]`） | C5 的「省 9%」標註、C11 的 per-point 值標籤 |
| `quote` | （可選）`attributionMeta?: string` | C4 的三段署名 |
| `features` | `columns?: 2\|3` | C9 固定 3 欄 |
| `two-col` | `bleed?: boolean` | C14 滿版 50/50 |

**新 template（建議）**：現有 6 個 → 加 `before-after`、`timeline`、`matrix`、`steps`、`split`、`hero-stat`、`quote-inverted`、`columns` ⇒ **約 14 個**。
（另一條路：template 保持 6 個、靠新 block 自撐版面。但設計稿的 16 個版式差異多在**頁級排版**而非 block 內部，走 template 擴充較貼合。）

**連帶必須同步的地方**（`SLIDE_TEMPLATES` / `SlideBlock` 是全系統單一真相）：
- `packages\shared\src\slide-spec.ts`（型別＋常數＋`extractSlideText` 的 walk 分支）
- `apps\web\components\slide\SlideRenderer.tsx`（`renderSlideBlock` 的 exhaustive switch **會編譯期報錯**提醒你）
- `apps\web\app\studio-present.css`（新 `.slide--*` / `.slide-block--*` 樣式）
- `apps\web\components\studio\BlockEditor.tsx`（template `<select>` ＋「新增區塊」按鈕列）
- `apps\web\components\studio\EditableSlide.tsx`＋`slide-block-ops.ts`
- server 端：Gemini 生成 schema 的 enum（import `SLIDE_TEMPLATES` / `AI_GENERATION_TEMPLATES`）、pptx exporter 的 typeMap、zod validator

---

## D. 風險與缺口

### D1. 設計稿有綁定、後端沒有資料（依畫面列欄位）

| 畫面 | 設計稿要的 | 後端狀態 | 依據 |
|---|---|---|---|
| **首頁 stats** | `這週開了幾場會`（12 場） | **無 meetings repo** | `packages\crm\src\ports.ts:613-647` 的 `CrmCore` 沒有 meetings；`meetings` 表存在（`005_deals_meetings.sql`）但無讀取路徑 |
| 首頁 stats | `該講的都講到 78%` | **無跨會議 checklist 聚合** | `repos-checklist.ts` 只有 per-meeting `list()` |
| 首頁 stats | `小幫手建議被採用 64%` | **無統計** | `suggestion_result` 只在 WS wire（`protocol.ts:94`），不落庫 |
| 首頁 stats | `這個月費用 126 / 上限 300`＋`月底大約 183` | **無 budget/cap、無預測** | 全 `packages/` 無 budget/cap 表或欄（見 §D1 #10 原盤點） |
| 首頁 stats delta | `比上週多 3 場`、`比上月好 6%` | **無期間比較** | 同上 |
| **首頁議程** | 今日會議列表（`time`/`dur`/`title`/`who`/`ready`） | **無 meetings repo**；`ready`（「12 件要講的事已備好」／「有 3 項資料還不確定」）**無欄位** | `meetings.scheduled_at` 在 DDL 但無 repo；checklist ready 只在 WS |
| **cockpit** | `sugTtl`「0:42 後失效」 | 有但名稱不同：`Suggestion.expiresAt`（絕對 ms） | `packages\shared\src\protocol.ts:63` |
| cockpit | `sugPos`「第 1/3 則」、`sugRest`「後面還有 N 則」 | 前端可自算（佇列長度） | — |
| cockpit | 逐字稿 `hi`（重點行標色） | **無欄位** | `TranscriptSegment`（`protocol.ts:20-32`）無 highlight/importance；`SignalItem` 是獨立 message，wire 上與 segment **無關聯 id** |
| cockpit | 情報卡 `src`（來源名稱如「法說會 7/09」「本場逐字稿」「徵才 JD 推測」） | 只有 `sourceUrl?`（URL 字串） | `protocol.ts:46`；`trust`（verified/crawler/live）可當來源等級 |
| cockpit | 情報卡分成「對方的資料／我們可以說」2 tab | `InfoCard.kind` 5 值（company/contact/battlecard/objection_handler/research）**可映射**（前 2 →them、後 2 →us、research→? ） | `protocol.ts:35` |
| cockpit | `session[]`「這台的角色：負責收音（不分享）」「手機提示：已連上 1 台」 | `session_state.connectedRoles` 有（`protocol.ts:106`）；「已連上 1 台」需計數 | — |
| cockpit | **「這場花的錢」4.12 / 上限 11.00** | **WS 協議完全無 spend message** | `ServerMessage` 10 種全列於 `protocol.ts:89-107`，無成本 |
| cockpit | 深查「今天還能查 4 次」 | `research_status.remainingQuota` 是 **per-meeting 記憶體計數**，無「今天/本週」概念、無持久化 | `protocol.ts:96`；`apps\server\src\realtime\session-runtime.ts:58` |
| **checklist** | `meta`「第 4 頁」／「正在講」／`tag`「要講/要問/要回答」／`pri` must-nice | **全部都有** ✅ `slideIdx?`／`status`／`category`(talk/ask/address)／`priority`(must/nice) | `packages\shared\src\checklist.ts:24-37` |
| checklist | `done` boolean | 用 `status: pending\|covered\|skipped` 三值表達 | `checklist.ts:16` |
| **present/start** | preflight 三項（收音正常／手機提示已連上／要講的事已備好） | **全新，無 API** | 前兩項可由前端偵測；第三項需 deck/meeting 的 checklist ready 欄位（無，見 §D1 #16 原盤點） |
| present/start | deck meta「已備好要講的事」 | **無持久欄位** | `Deck`（`deck.ts:43-62`）無 `checklistReady` |
| **CRM 清單** | `下次見面`（「今天 14:30」/「8/04」/「未排」） | **無欄位、無 meetings repo** | 同首頁議程 |
| CRM 清單 | `誰做決定`（「陳志豪 總監 / 林淑芬 CFO」摘要） | 需從 contacts 聚合（`decisionPower`+`title` 有） | `crm-types.ts:498`；但 `CompanySummary`（`:740-751`）不含 contacts |
| CRM 清單 | `資料可信度 84%` 進度條 | `crawlConfidence?`(0–1) 有 ✅ | `crm-types.ts:250` |
| CRM 清單 | `進度` 4 值（還沒聊過/談到一半/已成交/沒下文了） | `accountStatus` 4 值可映射 ✅（prospect/active/customer/churned） | `crm-types.ts:23` |
| CRM 清單 | 篩選器「資料不齊(5)」＋每個篩選的計數 | **無 facet count API** | `CompanyRepository.list`（`ports.ts:256`） |
| **CRM 詳情** | 6 張銷售敘事卡（他們今年要做什麼／現在用什麼／怎麼決定要買／還在比較誰／上次沒解決的事／我們可以說什麼） | **原料在、聚合不在**：`strategicInitiatives`／`currentVendors`／`painPoints`／`buyingTriggers` 有，但這 6 個問句是**新的敘事層** | `crm-types.ts:216-219` |
| CRM 詳情 | provenance 標籤「開會時聽到的」＋來源「7/30 逐字稿 24:41」 | **新來源類型**；`FieldProvenance` 無此值域 | `crm-types.ts:617-626` |
| CRM 詳情 | header meta「員工 1,200 · 台中」 | `employeeCount`／`hqCity` 有 ✅ | `crm-types.ts:196,211` |
| **Studio** | 縮圖列的來源標記「開會中補的」 | **無法區分**：`DeckSlide.kind` 只有 `original`/`spec`，`spec` 混合會前 AI 與會中批准 | `packages\shared\src\deck.ts:29-30` |
| Studio | 「開會中自動補的頁」通知（＋看那一頁／刪掉） | 同上，且無 `suggestionId`／`committedAt` | `deck.ts:123-134` |
| Studio | 主題 token 展示（主色從封面取的／標題字型／內文字型／logo 已抓到） | `SlideTheme` 有 `bg/text/accent/headingFont/bodyFont/logo` ✅ 但**per-slide 不是 per-deck**；`Deck.theme` 有 | `slide-spec.ts:17-25`、`deck.ts:56` |
| Studio | 匯入宣稱支援 `Google 簡報 / Keynote` | **只支援 pptx/pdf** | `DeckSourceKind = pptx\|pdf\|native`（`deck.ts:18`） |
| Studio | 「已自動存檔 · 12:41」 | `Deck.updatedAt` 有，但 `DeckRef`（詳情 wire）**不含它** | `deck.ts:78-87` |
| Studio | 「整理成要講的事」（從 deck 生 checklist） | **無此 API** | checklist 目前只在會中 WS 生成 |
| Studio | block 卡「自己看的小抄（投影不會顯示）」 | `SlideSpec.notes` 有 ✅ 但無編輯 UI | `slide-spec.ts:109` |
| **Train** | 3 個「客戶類型」persona（非 CRM 聯絡人） | **無此概念**——現有 persona 一律綁 `contactId` | `train.ts:190-206` |
| Train | `上次練習 · 7/28 · 8 分 12 秒 · 得分 74/100` | **三者皆無讀取路徑**：`TrainReport` 無 `overallScore`／無時間；`mapReport` 漏 `created_at`；`TrainingRepository` 無 `listSessions`/`latestByContact` | `train.ts:317-322`、`packages\crm\src\repos-training.ts:121-128`、`ports.ts:550-559` |
| Train | 6 個評分維度（開場／問出需求／講到對方在意的點／被質疑時的回應／談價格／收尾約下次） | 現有 sales mode 是 **4 維且名稱全不同** | `train.ts:60-65` |
| Train | 「最該改的一句」 | 近似 `TrainHighlight`（kind=improve）但設計稿是單一句 | `train.ts:308-314` |
| Train | 「錄音 7 天後自動刪掉」 | **無 retention 機制** | — |
| **Spend** | 5 個「功能」維度（開會小幫手／查客戶資料／做簡報／練習對話／臨時幫你查） | 只有 6 個「呼叫種類」（gemini_text/gemini_live/openai_image/embedding/asr/gemini_extract） | `packages\shared\src\ops-types.ts:14-22` |
| Spend | 月上限 300 ＋ 42% 進度 ＋ 月底預測 183 | **完全無 budget/cap** | 全 `packages/` grep 無 |
| Spend | `平均一場會議 4.86`／`最貴的一場 11.20`（＋會議名/時長/查詢次數） | `usage_events.meeting_id` 在，但 `rollup` **只 GROUP BY kind** | `packages\crm\src\repos-ops.ts:69`、`ops-types.ts:68-82` |
| Spend | `本週還能查幾次 還剩 4 次` | 同 cockpit：per-meeting 記憶體，無週期 | `protocol.ts:96` |
| **Team** | `最近做了什麼`（「剛剛 · Acme 會議」） | **無欄位** | `OrgMember` 只有 `createdAt`（`ops-types.ts:117-123`）；`activities` 表有 `user_id`+`occurred_at` 但無關聯 |
| Team | 成員＋邀請合併一張表、`狀態` pending/active | **兩張表、無合併形狀** | `MemberRepository.list` ＋ `InviteRepository.list`（`ports.ts:580-607`） |
| Team | 角色第 4 值「只能看」 | **`Role` 只有 3 值** | `packages\crm\src\ports.ts:91` |

**優先級判斷**（給規劃者）：
- **P0 阻擋整頁的**：首頁議程＋4 KPI（需 meetings repo）、spend 月上限、train「上次練習」、team「最近做了什麼」、CRM「下次見面」
- **P1 降級可用的**：逐字稿 highlight（可先不標色）、情報卡 `src`（可只顯示 trust）、slide「會中補的」標記（可先用 `i >= originalCount` 近似）
- **P2 純前端可算的**：`sugPos`/`sugRest`/`sugTtl`、CRM 篩選計數（若一次抓全量）、含稅金額（若 API 補回稅率）

### D2. 淺色預設 vs 現有深色的遷移面

| 面 | 現況 | 設計稿 | 遷移工作 |
|---|---|---|---|
| **token 表** | `globals.css:4-49` 的 `--mc-*`（30+ 個，深藍＋紫）＋`color-scheme:dark` | 18 個 `--bg/--panel/--ink/--acc/…`（暖米白＋青藍，雙主題） | **全換**。`--mc-*` 與新 token **零名稱交集** → 建議先在 `:root` 定義新 token，再把 `--mc-*` 逐個 alias 到新 token（漸進遷移），最後刪除舊名。`color-scheme` 要改成 `light dark` 或依 `data-theme` 切換（**否則淺色主題下 UA 表單控件/捲軸仍是深色**——`globals.css:5-7` 的註解明確說明它為什麼在那）。 |
| **class 命名** | 全站 `.mc-*` BEM-ish（`globals.css` 1552 行 ＋ `studio-present.css` 537 行） | **零 class，純 inline style** | 設計稿不提供 class 對照。實作要自行把 inline style 映回既有 `.mc-*` class（**建議路線**：保留 class 架構，只改 CSS 的值），否則要重寫 2000 行 CSS。 |
| **`studio-present.css` 的 `.slide` 系統** | 10 個 `--slide-*` 變數，預設值全部 fallback 到 `--mc-*`（`--slide-bg: var(--mc-card)` 等，`studio-present.css:10-20`） | 舞台底 `#111211`、投影片 `#F7F5F1`、字 `#15130F`——**硬寫淺色，不吃 app 主題** | **兩層要分開處理**：<br>① `.slide` 的**預設值**（無 `theme` 時）要從 `--mc-card`（深藍卡）改成淺色紙張（`#F7F5F1` 或 `--panel`）。<br>② 舞台外框（`.mc-present`，現 `#05070f`）改 `#111211`。<br>③ **`--slide-*` 的 override 機制不要動**——匯入 deck 的 `theme` 覆寫必須繼續生效（這是「新頁繼承 anchor theme」的基礎，`slide-spec.ts:15`）。<br>④ mesh 漸層背景（`css:38-50` 對 title/section/stats/closing 加三層 radial-gradient）在設計稿裡**完全消失** → 需決定是移除還是改成極淡。<br>⑤ `stat__value` 的漸層文字（`css:160`）在設計稿是純 `--ink` → 需決定。 |
| **`cqw` 單位系統** | `.slide` 內全部用 `cqw`（container query width），字級如 `8.4cqw`、`11cqw` | 設計稿用 px（820px 畫布上的 42px ≈ 5.1cqw；1120px 舞台上的 52px ≈ 4.6cqw） | **必須換算**。設計稿的編輯器畫布是 820px、舞台是 1120px，**同一模板在兩處的 px 值不同**（52px vs 29px 標題）→ 證明設計者是**分別**為兩個尺寸畫的。實作要統一成 `cqw`（用舞台 1120px 換算比較安全）。 |
| **字體** | `next/font` Geist + Geist_Mono；`--mc-font` 是 system stack | Space Grotesk + IBM Plex Mono + Noto Sans TC（Google Fonts） | 換 `next/font/google` 三個字族。**注意 Noto Sans TC 是大檔**（繁中全集），要用 `subsets`/`display:swap`。 |
| **深色作為次要主題** | 深色是唯一主題 | 深色仍在（`[data-theme="dark"]`），但**是中性暖灰黑，不是深藍** | 舊的深藍紫配色**整套廢棄**。任何硬寫 `rgba(139,92,246,…)`（紫）的地方（`globals.css` 有 20+ 處）都要換成 `color-mix(in srgb, var(--acc) …)`。 |
| **RWD** | ≤880px off-canvas drawer、`is-rail` 收合、多處 `@media` | **0 個 `@media`**；copilot/studio `min-width:1120px` | 設計稿是純桌機。現有 RWD **必須保留**（尤其 `/hud` 是手機用的）。設計稿的 HUD 手機框（392×748）給了手機視覺，但**沒有 breakpoint 定義** → 實作要自行決定斷點。 |

### D3. present 舞台畫面（I3）稽核結論

**已在 §B5 詳述，此處摘要為可執行的守則：**

1. ✅ **投影片框內確認乾淨**：只有 eyebrow / h2 / 3 欄內容。無 checklist、無建議、無逐字稿、無情報卡、無進度、無 signals。
2. ⚠ **控制列有兩句「提及 HUD」的文字**（「只顯示簡報 · 可安全分享」「要講的事和建議只在你手機上」）。內容本身無洩漏，但會出現在被分享的畫素上。
   → **建議刪除或改為僅在本機 hover 時淡入**（現有 `PresentStage.tsx` 的控制列已是「指標動→顯著、靜止 2.5 秒→淡出」，把這兩句掛進同一機制即可）。
3. 🔴 **原型結構會帶 sidebar 進舞台**：`isStage` 的 `<main>`（行 396）是行 89 右欄的子節點，而行 46 的 `<aside>`（含使用者姓名、組織、nav、主題鈕）**無條件渲染**。
   → **實作硬要求**（不可妥協）：
   - `/present` 的 page **不得**包 `AppShell`（維持 `app\[locale]\present\page.tsx` 現況）
   - `app\[locale]\layout.tsx` 維持零 chrome
   - `PresentStage.tsx` 維持檔頭 import 白名單（只 `SlideRenderer` / `lib/api` / `lib/ws` / shared 型別 / `next-intl` / `@/i18n/navigation`）
   - `onMessage` 維持只處理 `deck_update` / `session_state`，其餘 `default: break`
   - 從設計稿只取「配色（`#111211` / `#F7F5F1`）＋投影片框（`aspect-ratio:16/9`、6px 圓角、重陰影）＋控制列樣式」，**不取版面樹**
4. ✅ **舞台不吃 `data-theme`** 是設計意圖（投影一致性），實作要保留：`/present` 不套用主題變數，或硬設 `data-theme="light"` 的子集。
5. ⚠ 舞台的頁碼「04 / 12」對應現有 `mc-present__pageno`（`aria-hidden`）。設計稿把它放在控制列中央、與說明文字同一行 → 若照做，連線狀態小圓點（`--open/--connecting/--reconnecting/--failed`）沒有位置，需另安排。

### D4. 其他結構性風險

| # | 風險 | 說明 |
|---|---|---|
| R1 | **設計稿是「單一 shell 展示 11 個畫面」的原型** | `data-theme` 在一個 `<div>` 上、sidebar 無條件渲染、所有畫面是 `sc-if` 兄弟。**不能把這個結構當版面契約**。尤其影響：`/present`（I3，見 §D3）、`/hud`（現況零 chrome）、`/login`+`/invite`（現況零 chrome）。 |
| R2 | **I2 的 EDIT 分支在設計稿裡消失** | 建議卡只有「照這樣說／跳過／幫我查一下」，**沒有「編輯後接受」**。現有 `SuggestionQueue.tsx` 有 `EditPanel`（eyebrow＋標題兩欄）。<br>CLAUDE.md I2：「新頁進 live deck 前必經 approval gate（**只有 ACCEPT/EDIT 會 append**）」。<br>→ **移除 EDIT 會削弱 I2 的表達力**（報告者失去「修正後再上」的中間選項，只能全接受或全丟）。**依 CLAUDE.md 規定，這需要停下來問使用者。** |
| R3 | **建議的語意可能已從「投影片」漂移成「話術」** | 設計稿的建議卡：標題是**一句可以照唸的話**（「他們第三次提到『什麼時候能上線』了 — 現在把六週的做法講清楚，再提 30 天試用。」）、按鈕是「**照這樣說**」、**沒有投影片縮圖**。<br>現有 `Suggestion` 的 payload 是 `slide: SlideSpec`（整份投影片）＋`reason`，按鈕是「接受」＝append 一頁到 deck。<br>→ 兩者是**不同產品**：一個是「即時話術提示」，一個是「DynamicSlide 補頁批准」。<br>設計稿其他地方顯示 DynamicSlide 仍在（Studio 的「開會中自動補的頁」通知、縮圖的「開會中補的」標記、模板陳列室的「AI 可填」），所以推測**兩者並存**——但 cockpit 主卡只畫了話術那條。<br>→ **這是最需要向使用者確認的一點**：cockpit 的批准佇列去哪了？是移到別處、還是合併成同一張卡？ |
| R4 | **consent（同意）UI 在設計稿裡消失** | 現有 `CopilotInner` 有 `ConsentGate` checkbox（會前必勾才能聆聽）＋`TabShareTutorial`。設計稿的 cockpit 直接是 LIVE 狀態。<br>→ 錄音同意是**合規要求**，不可因設計稿沒畫就移除。 |
| R5 | **setup 相位缺失** | 設計稿沒有「建立 session」表單（會議標題／選簡報／選對方公司／會議目標）。cockpit 直接假設 session 存在。<br>→ 需決定 setup 放哪（可能移到首頁議程的「開始開會」CTA 之後？設計稿的議程列有「開始開會」按鈕直接 → copilot，暗示 session 由議程建立——但議程本身依賴不存在的 meetings repo）。 |
| R6 | **`adminOnly` 權限分支消失** | 設計稿 nav 的「管理」群組（spend/team）無條件顯示。現有 `AppShell.tsx:142-148,193` 是 owner/admin 才顯示。**必須保留權限判斷**。 |
| R7 | **所有 loading / error / empty 三態無設計** | 現有 12 個 `components\ui\*` 元件（`StateBoundary`／`EmptyState`／`Spinner`／`Toast`／`ConfirmDialog`／`JobProgressCard`…）在設計稿裡零對應。每個畫面都要自行推導。<br>→ 建議：從設計稿的 warn 卡（行 526–530、850–857）與深查進行中列（行 226–230）反推 empty/loading 視覺語言。 |
| R8 | **i18n 覆蓋率** | 設計稿只翻譯 3 個字串（`tHomeTitle`/`tHomeLead`/`tEnterCopilot`），其餘 200+ 字串硬寫繁中。現有全站走 `next-intl`＋`messages/`。<br>→ 設計稿的**繁中文案本身是重要產出**（口語化改寫，如「CRM 公司」→「客戶資料」、「AI 花費」→「用了多少錢」），需逐字搬進 `messages/zh-TW.json`，並補對應英文。 |
| R9 | **`/sim` 被完全省略** | nav 沒有「測試」群組、沒有畫面。`MeetingSimulator.tsx` 是驗 I1/I2 的端到端工具。→ 需確認是刻意下架還是遺漏。 |
| R10 | **舞台與編輯器的同一模板尺寸不一致** | 見 §D2 的 `cqw` 一列。設計稿的 T3（stage `three-col-rule`，52px 標題）與 T1（editor `kpi-cards-3`，29px 標題）字級差 1.8 倍，因為畫布寬不同（1120 vs 820）。**實作用 `cqw` 才不會踩**。 |

### D5. 設計稿內看起來像「指示文字」的內容（照實引述，**不照做**）

以下文字出現在設計稿的 UI 裡，但性質是**設計者對閱讀者/實作者的說明**，或**產品文案裡對自身架構的解釋**。照實引述以供判斷，盤點者不對它們採取行動：

1. **HUD 畫面右側 3 張「說明卡」**（行 1231–1235，`hudNotes`）——整組是設計說明，不是產品 UI：
   - 「**為什麼分成兩個畫面** / 投影出去的只有簡報 / 分享螢幕時對方只看到簡報本身，要講的事、建議、對話紀錄都留在你自己的手機或電腦上。」
   - 「**為手機設計** / 一眼看到重點 / 清單收成一行進度條，建議永遠在第一眼的位置；按鈕夠大，站著單手也按得到。」
   - 「**網路斷掉也沒事** / 重新連上就自動同步 / 手機和電腦看到的永遠一樣；中途斷線重連後，進度會自動補回來。」
2. **HUD header 的 lead**（行 298）：「跟電腦版是同一份內容，只是排成手機直式：要講的事在最上面，建議在第一眼看得到的位置。投影出去的畫面只有簡報，這些提示不會被別人看到。」
3. **舞台控制列**（行 415–416）：「04 / 12 · **只顯示簡報 · 可安全分享**」「**要講的事和建議只在你手機上**」——見 §D3 建議刪除。
4. **模板選擇條 kicker**（行 798）：「換一個版型 · **這頁的內容會自動套過去**」——這是功能承諾（換模板保留內容），實作上是真需求，但文案本身是說明。
5. **Studio 匯入卡**（行 821）：「把公司現成的簡報拉進來就好。**開會中臨時要補的頁，會照這份簡報的字體和顏色新增，看起來像同一份。**」＋（行 830）「新增的頁會沿用這份簡報的樣式」——描述現有的 anchor-theme 繼承機制（`slide-spec.ts:15`）。
6. **Studio 的「開會中自動補的頁」卡**（行 852）：「對方問到『資安審查要多久』時，小幫手照你的版型補了第 7 頁，字體顏色跟原簡報一致。」——這是**功能示範文案**，同時也是最明確的「會中補頁」情境說明。
7. **圖片佔位提示**（行 671、770）：「［ 放產線照片 · **建議 1600×900** ］」「［ 放系統畫面截圖 ］」——設計佔位標記。
8. **cockpit 頂列**（行 205）：「鍵盤：A 照著說　S 跳過」——是真的 UI 提示（`componentDidMount` 有綁 keydown，行 1062–1068），保留。
9. **present/start 底部**（行 389）：「Esc 離開 · ← → 換頁 · **提示只在你手機上**」——前半是操作提示（保留），後半是架構說明。
10. **train 底部**（行 918）：「過程會錄音，只用來評分，**7 天後自動刪掉**」——是**產品承諾**，但後端**沒有 retention 實作**（見 §D1）。照做前必須先有機制。
11. **spend 卡**（行 1440）：「本週還能查幾次 / 還剩 4 次 / **用完之後會改成較簡單的摘要**」——是降級策略承諾，後端無此邏輯。
12. **cockpit 逐字稿 kicker**（行 237）：「重要的話會標色」——功能說明，但後端無 highlight 欄位（見 §D1）。

---

## E. 給後續實作 agent 的快速索引

| 我要做… | 先看本檔 | 再看設計稿行號 | 對照現有檔案（絕對路徑） |
|---|---|---|---|
| 換 token / 主題 | §A2 §A3 §A9 §D2 | 15–41 | `c:\Users\Martin\Desktop\MeetCopilot\apps\web\app\globals.css:4-49` |
| 換字體 | §A1 §D2 | 11–13, 33 | `c:\Users\Martin\Desktop\MeetCopilot\apps\web\app\[locale]\layout.tsx` |
| 改側欄 | §B0 | 44–87, 1099–1118 | `c:\Users\Martin\Desktop\MeetCopilot\apps\web\components\AppShell.tsx` |
| 改首頁 | §B1 §D1 | 92–164, 1175–1195 | `…\apps\web\components\home\HomeDashboard.tsx` |
| 改 cockpit | §B2 §D4-R2/R3/R4/R5 | 167–289, 997–1036 | `…\apps\web\components\copilot\CockpitView.tsx`、`…\components\hud\*` |
| 改 HUD | §B3 | 292–351, 1231–1235 | `…\apps\web\components\hud\HudView.tsx` |
| 改 present/start | §B4 | 354–393, 1237–1252 | `…\apps\web\components\present\PresentStart.tsx` |
| 改舞台（**先讀 I3 守則**） | §B5 §D3 | 396–418 | `…\apps\web\components\present\PresentStage.tsx` |
| 改 CRM 清單 | §B6 | 422–464, 1038–1047, 1259–1272 | `…\apps\web\components\crm\CompanyListView.tsx` |
| 改 CRM 詳情 | §B7 | 467–534, 1273–1290 | `…\apps\web\components\crm\CompanyDetailView.tsx`、`ChildTabs.tsx` |
| 改 Studio | §B8 | 537–560, 796–860, 1292–1311, 1408–1413 | `…\apps\web\components\studio\SlideEditor.tsx`、`BlockEditor.tsx` |
| **做新 slide 模板** | **§C（全節）** | **565–795, 1334–1359** ＋各模板資料 1316–1407 | `c:\Users\Martin\Desktop\MeetCopilot\packages\shared\src\slide-spec.ts`、`…\apps\web\components\slide\SlideRenderer.tsx`、`…\apps\web\app\studio-present.css` |
| 改 train | §B9 | 863–922, 1146–1150, 1421–1428 | `…\apps\web\components\train\TrainWorkbench.tsx` 等 |
| 改 spend | §B10 §D1 | 925–958, 1430–1441 | `…\apps\web\components\spend\SpendDashboard.tsx` |
| 改 team | §B11 | 961–990, 1442–1449 | `…\apps\web\components\settings\TeamSettingsView.tsx` |
| 找沒設計的畫面 | §B12 | — | — |
| 找後端缺的欄位 | §D1 | — | `packages\shared\src\*.ts`、`packages\crm\src\ports.ts` |
| 凍結新 slide contract | §C20 | — | `packages\shared\src\slide-spec.ts:77-101` |

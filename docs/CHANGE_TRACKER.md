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

（尚無）

---

<!-- TRACKER_BELOW -->

### 2026-07-07 21:40 | M0 地基全量落地（工作流 5 agent；指揮官代記一組）
- **工作區**: repo 根＋packages/shared＋packages/crm＋apps/server＋apps/web
- **類型**: feat
- **檔案**: 根 `package.json`/`tsconfig.base.json`/`.env.example`/`.gitignore`（補 `*.db-wal`/`*.db-shm`）；`packages/shared/src/{slide-spec,protocol,signals,crm-types,trust,index}.ts`；`packages/crm/src/{ports,sqlite-db,migrate,repos,core,uuid,index}.ts`＋`migrations/001_tenancy.sql`＋`test/crm-core.test.ts`；`apps/server/src/{config,crm,index,gemini,ws}.ts`＋`auth/{jwt,routes,index}.ts`＋`providers/image.ts`＋`scripts/smoke-auth.mjs`＋jwt 測試；`apps/web` Next15+next-intl 骨架（六路由佔位、lib/{api,ws}.ts、messages）
- **改了什麼**: monorepo 骨架＋凍結契約實作。關鍵設計：slide-spec 的 PatchOp 改 **append-only**（`APPEND`/`REORDER`，`patchMinIndex(op, deckLength)` 簽名變更）；DbPort async-first、tx 用手動 `BEGIN IMMEDIATE`（不用 better-sqlite3 的 sync transaction）；auth 全流程過 crm repos（僅 login 的 findPrimaryMembership 留一處明標 direct-SQL shim，M1 升級 ports 後移除）；ws 只掛 hello/ping（M3 補全）；OpenAIImageProvider 編譯就緒未掛路由（M2）。
- **為什麼**: M0 里程碑（ARCHITECTURE_PLAN §6）。A5 fresh-context 驗收 6/6 PASS（typecheck 全綠、crm 7/7 測試、真 server 冒煙含跨 org 隔離與 dup-409、JWT fail-fast exit 1、契約零漂移、/present 無副駕詞彙）。

### 2026-07-07 17:20 | capture-test 加 Brave 偵測
- **工作區**: tools
- **類型**: fix
- **檔案**: `tools/capture-test.html`
- **改了什麼**: `runEnvCheck()` 在 UA 嗅探後加 `navigator.brave.isBrave()`（async）判別——Brave 時把瀏覽器標記更正為「Brave x.y（Chromium，UA 顯示 Chrome）」並更新畫面/JSON/日誌。Before：UA 嗅探把 Brave 誤判成 Chrome。After：矩陣記到真實瀏覽器。改後重抽 `<script>` 跑 `node --check` PASS。
- **為什麼**: 使用者第一筆實測（2026-07-07，9 項全 PASS）實際用的是 Brave，但工具記成 Chrome 150——Brave 的 UA 偽裝成 Chrome，會讓相容性矩陣把 Brave 的結果誤記到 Chrome 帳上。

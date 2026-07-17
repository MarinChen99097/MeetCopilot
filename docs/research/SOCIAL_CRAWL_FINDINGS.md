# 社群平台情報取得可行性查證（FB / IG / Threads / YouTube）

> **查證日期**：2026-07-13
> **用途**：MeetCopilot CRM 研究爬蟲擴充決策（B2B：輸入對方公司名/官網 → 拿社群帳號、公開貼文/影片、粉絲/訂閱數、發文頻率、近期活動與輿情）。
> **方法**：全程 WebSearch/WebFetch 查證，官方文件優先於部落格；分清「官方宣稱」與「第三方實測」。查不到即標「查不到」，未編造數字。
> **技術棧前提**：Node/Express、Playwright(+stealth)、Gemini Google Search grounding（@google/genai）。

---

## 0. 全域重大變化（2025–2026，先看）

1. **Google 開始索引 Meta 公開專業帳號內容（2025-07-10 生效）**：IG 與 FB 的「專業帳號（Business/Creator，帳號持有人 18+）」之公開貼文/Reels/輪播/圖說/hashtag/地點/bio，自 2025-07-10 起自動被 Google 等搜尋引擎索引（可回溯至 2020-01-01 之後的內容）；個人/私人帳號不索引，且帳號可在設定關閉。這是 Meta 史上第一次讓原生內容在自家生態外被廣泛檢索 → **直接放大 Gemini Google Search grounding 對 IG/FB 的可用度**。來源：[ppc.land](https://ppc.land/instagram-content-becomes-searchable-on-google-starting-july-10/)、[verdemedia](https://verdemedia.com/blog/instagram-facebook-posts-indexed-in-google)、[boderia](https://www.boderia.io/insights/google-is-indexing-instagram-posts-what-you-must-know)。
2. **Meta v. Bright Data（2024-01 裁決）**：法院認定 Meta 的 FB/IG 服務條款**只禁止「登入態」爬取，不禁止「登出態」爬取公開內容**。來源：[Farella Braun + Martel](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/)、[Quinn Emanuel](https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/)、[Social Media Today](https://www.socialmediatoday.com/news/meta-abandons-legal-case-data-scraping-losing-key-judgment/708538/)。
3. **YouTube Data API 配額成本 2025-12-04 調降**：`videos.insert` 從 ~1,600 units 降到 ~100 units（主要影響上傳，非讀取）。來源：[getphyllo](https://www.getphyllo.com/post/is-the-youtube-api-free-costs-limits-iv)。
4. **Meta Graph API 現行版本 v25.0（2026-02-18 發布）**；Threads 官方 Public API 已上線並在 2025 擴充搜尋/分析功能。

---

## 1. YouTube

### Q1 官方 API 現況
- **YouTube Data API v3**：每個 Google Cloud 專案預設**每日 10,000 units 免費配額**，無按次金錢費用，太平洋時間午夜重置；同專案多把 key 共用同一池。來源：[Google 官方 Quota guide](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)、[Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)。
- **可得資料**：
  - `channels.list`（1 unit）→ `statistics`：`viewCount`、`subscriberCount`（>1,000 訂閱者**四捨五入到 3 位有效數字**）、`videoCount`、`hiddenSubscriberCount`。來源：[Channels doc](https://developers.google.com/youtube/v3/docs/channels)、[ChannelCrawler](https://channelcrawler.com/insights/youtube-api-channels-get-channel-id-name-url-views-subscriber-count-channelcrawler)。
  - `videos.list`（1 unit）→ 標題、描述、標籤、`statistics`（viewCount/likeCount/commentCount）。
  - `commentThreads.list`（1 unit）→ 留言。
  - `search.list`（**100 units/次**，每頁再 100）→ 依關鍵字/頻道找影片，但**每日僅約 100 次搜尋**就用完配額。來源：[Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)。
- **實務含意**：查特定公司頻道的訂閱數/影片清單/描述/發文頻率**成本極低（各 1 unit）**；貴的只有 `search`（找頻道時用）。B2B 場景幾乎全靠 1-unit 呼叫即可，10,000/日綽綽有餘。

### Q2 無登入公開網頁可爬性
- YouTube 頻道頁/影片頁**不需登入**即可看；HTML 內嵌 `ytInitialData` 與 `ytInitialPlayerResponse` JSON；亦可打內部 `/youtubei/v1/` 端點取得與前端相同的 search/channel/comments JSON（配 continuation token 分頁）。**yt-dlp** 是社群公認的 metadata/留言/字幕主力工具（自帶節流）。來源：[Live Proxies 指南](https://liveproxies.io/blog/how-to-scrape-youtube)、[DEV 2026 指南](https://dev.to/agenthustler/how-to-scrape-youtube-in-2026-videos-channels-comments-and-metadata-27pn)、[Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-youtube)。
- **封鎖程度（第三方實測）**：有反爬；規模化需住宅代理與 header 管理，須把 429/5xx/consent 重導當不同失敗類型分別退避。小量無登入可行，大量需代理輪替。來源同上。

### Q3 第三方資料服務
- **Apify**：有 YouTube Channel Scraper（全影片＋統計）等 actor，宣稱免 API key、免每日配額。來源：[Apify YouTube Channel Scraper](https://apify.com/convertfleetdotonline/youtube-channel-scraper)。
- **Bright Data**：Social Media Scraper 涵蓋 YouTube（videos/channels/comments），**$1.5/1K records**（Pay-as-you-go），每月 5K records 免費、無需信用卡。來源：[Bright Data 官方定價頁](https://brightdata.com/products/web-scraper/social-media-scrape)。

### Q4 Gemini Google Search grounding 可間接撈多少
- YouTube 內容被 Google 深度索引 → grounding 可撈到影片標題/描述/頻道資訊。**額外強項**：Gemini 有**原生 YouTube URL 理解**（非 grounding）——可直接把公開 YouTube URL 當 fileData part 丟給模型做摘要/描述/問答，處理視覺＋音訊；限制：**僅公開影片**、每日上傳量上限 8 小時、Gemini 2.5+ 每請求最多 10 支影片。來源：[Gemini Video understanding 官方](https://ai.google.dev/gemini-api/docs/video-understanding)。

### Q5 ToS / 法律風險
- **官方 API**：風險最低，但受 [YouTube API Services ToS](https://developers.google.com/youtube/terms/api-services-terms-of-service) 與 [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) 約束（禁止規避配額、限制資料留存）。
- **無登入爬取**：技術可行、公開資料，但違反 YouTube ToS（禁止自動化存取/規避配額）；主要實務風險為 IP 封鎖。
- **登入態爬取**：最高風險（帳號封禁＋ToS 違反）——B2B 讀公開資料無必要走登入態。

---

## 2. Facebook

### Q1 官方 API 現況（讀「非自家」公開粉專）
- 讀取自己不管理的公開 Page 需 **Page Public Content Access（PPCA）** 功能：**必須先通過 App Review，且需 Business Verification（商業驗證），可能還要簽額外協議**。審核前只能讀「你本人是 admin 且在 app 內有 admin/developer/tester 角色」的 Page；要讀其他 Page 的公開內容必須送審此功能。可讀：企業管理平台中繼資料、公開留言與貼文。來源：[Meta 官方 PPCA 文件](https://developers.facebook.com/docs/features-reference/page-public-content-access)。
- **實務含意**：官方途徑讀任意競品粉專門檻高（審核數週、需商業驗證），對「輸入任意公司名就要拿資料」的通用爬蟲不友善。現行 Graph API 版本 v25.0（2026-02）。來源：[Data365 分析](https://data365.co/blog/meta-graph-api)、[SocialCrawl](https://www.socialcrawl.dev/blog/facebook-data-api-2026)。

### Q2 無登入公開網頁可爬性
- Facebook 對公開頁**堆疊三層防禦**：檢查 TLS handshake、HTTP/2 SETTINGS frame、瀏覽器指紋——`requests.get()` 直接被導向 login wall，預設 headless Chromium 首次導航即被標記。部分 modal（如 Marketplace/Events）可用 `div[aria-label="Close"]` 關掉看到公開資料，但貼文常在 login wall 後。需**住宅代理輪替＋大幅放慢**（第 11 次請求可能就被擋）。Playwright 對 FB 的 JS 環境是必需。來源：[DEV 2026 指南](https://dev.to/vhub_systems_ed5641f65d59/how-to-scrape-facebook-public-data-without-the-graph-api-in-2026-4ack)、[Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-facebook)。
- **結論**：FB 是四平台中無登入自建爬取**最難**的，封鎖強。

### Q3 第三方資料服務
- **Apify Facebook Posts Scraper**：**$2.00/1K posts**（無登入）；回傳貼文文字、likes/reactions/shares、留言數與熱門留言、reaction 分類、媒體 URL、影片轉錄；**不含粉絲數**（focus 在貼文層級）。來源：[Apify facebook-posts-scraper](https://apify.com/apify/facebook-posts-scraper)。
- **Bright Data**：Facebook（posts/profiles/comments/marketplace/events/reels）**$1.5/1K records**；另有 Facebook Profiles Dataset 31M+ 筆，**$250/100K records**。來源：[Bright Data 官方定價頁](https://brightdata.com/products/web-scraper/social-media-scrape)、[Bright Data FB scrapers 評比](https://brightdata.com/blog/web-data/best-facebook-scrapers)。

### Q4 Gemini Google Search grounding
- **2025-07-10 起 FB 公開「專業帳號」內容被 Google 索引**（圖說/bio/地點/歷史內容回溯 2020-01）→ grounding 可撈到公開專業粉專內容；個人/私人不索引。來源：[verdemedia](https://verdemedia.com/blog/instagram-facebook-posts-indexed-in-google)、[holisticmarketingllc](https://holisticmarketingllc.com/blog/what-it-means-now-that-meta-posts-will-be-indexed-on-search-engines)。

### Q5 ToS / 法律風險
- **官方 API（PPCA）**：最低法律風險但門檻高。
- **無登入公開爬取**：依 Meta v. Bright Data（2024-01），Meta ToS**不約束登出態**爬公開內容，且 hiQ 案下公開資料不觸 CFAA；主要風險是 IP 封鎖與訴訟成本（即使勝訴也貴——hiQ 最終付 $500K 和解並倒閉）。來源：[FBM](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/)、[ScrapeCreators 法律指南](https://scrapecreators.com/blog/is-web-scraping-legal-a-guide-based-on-recent-court-ruling)。
- **登入態爬取**：**最高風險**——FB ToS 明文禁止登入態自動化，帳號封禁即時。

---

## 3. Instagram

### Q1 官方 API 現況
- **Instagram Graph API business discovery 端點**：可讀「**其他**帳號」的公開資料，但**對方必須是 Business/Creator 且帳號公開**（個人/私人不可讀）。可取：`followers_count`、`follows_count`、`name`、`biography`、`username`、`profile_picture_url`、`media_count`，以及 media 的 caption/like_count/comments_count/media_url/permalink/timestamp。呼叫方需自有 IG Business 帳號＋FB app（＋相關 app review）。來源：[Meta 官方 Business Discovery 文件](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/)。
- **拿不到**：其他人的個人檔案內容、公開 hashtag 串流、競品跨帳號分析、追蹤者名單、廣泛探索資料。**2025-01-08（v21）起 deprecate** 部分 Insights 指標（profile_views、website_clicks 等）。來源：[Elfsight 2026 指南](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/)、[Storrito](https://storrito.com/resources/instagram-api-2026/)。

### Q2 無登入公開網頁可爬性
- 無登入可看＝incognito 可見的公開 profile/post；爬法是打 IG web app 用的隱藏 REST/GraphQL 端點（非解析 HTML），**免帳密/免 API key**。但 **hashtag/關鍵字瀏覽自 2024 起需登入**。IG **對單一 IP 封鎖極快、標記資料中心 IP 段** → 需住宅/行動代理＋TLS 指紋偽裝（curl_cffi 假冒 Chrome）。第三方實測：純 Python/headless 跑幾個 profile 後就撞 rate limit/IP ban/需登入。來源：[Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-instagram)、[SocialCrawl](https://www.socialcrawl.dev/blog/instagram-scraping-2026)、[dataimpulse](https://dataimpulse.com/blog/how-to-scrape-instagram/)。

### Q3 第三方資料服務
- **Apify apidojo/instagram-scraper**：**約 $0.47–0.50/1K posts**（宣稱**免登入、免代理**），回傳貼文/owner（含 follower count、驗證狀態）/圖說/媒體 URL/地點。來源：[Apify apidojo](https://apify.com/apidojo/instagram-scraper)。
- **Apify 官方 apify/instagram-scraper**：依方案 **$1.50–$2.70/1K**（Free $2.70、Starter $2.30、Scale/Business $1.50–1.90），免登入，涵蓋 profiles/posts/reels/comments/hashtags。來源：[Apify instagram-scraper](https://apify.com/apify/instagram-scraper)。
- **Bright Data**：IG（profiles/posts/reels/comments）**$1.5/1K records**。來源：[Bright Data 定價頁](https://brightdata.com/products/web-scraper/social-media-scrape)、[Bright Data IG scrapers 評比](https://brightdata.com/blog/web-data/best-instagram-scrapers)。

### Q4 Gemini Google Search grounding
- **2025-07-10 起 IG 公開「專業帳號」內容被 Google 索引**（貼文/Reels/輪播/圖說/hashtag/地點/公開留言，回溯 2020-01）→ grounding 可間接撈到；個人/私人不索引。來源：[ppc.land](https://ppc.land/instagram-content-becomes-searchable-on-google-starting-july-10/)、[facelift-bbt](https://facelift-bbt.com/en/blog/google-starts-indexing-instagram)。

### Q5 ToS / 法律風險
- **官方 business discovery**：最低風險，但範圍窄（只公開 Business/Creator）。
- **無登入公開爬取**：同 Meta v. Bright Data 原則，登出態不受 ToS 約束；風險為 IP 封鎖與訴訟成本。
- **登入態爬取**：**最高風險**——IG ToS 明文禁止自動化存取，帳號封禁即時。來源：[SociaVault 合規指南](https://sociavault.com/blog/instagram-scraping-legal-2025)。

---

## 4. Threads

### Q1 官方 API 現況（讀他人公開貼文）
- **Threads 官方 Public API**（2024 上線、2025 擴充）為 REST＋OAuth 2.0（scopes：read_threads/write_threads/metrics_threads）。**Keyword Search 端點**（`/keyword_search`）可搜尋**公開** Threads 貼文（text/image/video），但**需 `threads_keyword_search` 權限（app review）；未核准前只能搜「已驗證使用者本人」的貼文**。速率限制：每使用者 24h 滾動窗最多 **2,200 次查詢**（跨 app 共用、無結果不計）。來源：[Meta 官方 Keyword Search 文件](https://developers.facebook.com/docs/threads/keyword-search/)。
- **官方定位**：偏向「代使用者發文＋讀自己內容＋（核准後）公開關鍵字搜尋」，**並非為大量讀取他人公開資料做分析設計**；要抓某競品帳號「整條時間軸」無官方端點 → 這也是外界改用爬取的原因。來源：[SociaVault](https://sociavault.com/blog/scrape-threads-data-unofficial-api-2026)、[Social Media Today](https://www.socialmediatoday.com/news/meta-updates-threads-api-with-more-third-party-app-integrations/817502/)。

### Q2 無登入公開網頁可爬性
- threads.net 的 profile/post 頁**不需登入即可看**；資料以 `<script>` 內 JSON（hidden web data）載入，須用 headless 瀏覽器（Playwright）＋攔截 network/API 請求，用 jmespath 解析 JSON。**搜尋結果與部分 metadata（如 follower/following 名單）需登入**。合理速率下可行。來源：[Scrapfly Threads 指南](https://scrapfly.io/blog/posts/how-to-scrape-threads)、[Threadify](https://www.threadify.app/blog/can-you-view-threads-without-an-account)。

### Q3 第三方資料服務
- **Apify**：多個 Threads Scraper actor（posts/profiles/search results）。來源：[Apify magicfingers/threads-scraper](https://apify.com/magicfingers/threads-scraper)、[automation-lab/threads-scraper](https://apify.com/automation-lab/threads-scraper)。
- **Bright Data**：Threads（profiles/posts）**$1.5/1K records**。來源：[Bright Data 定價頁](https://brightdata.com/products/web-scraper/social-media-scrape)。

### Q4 Gemini Google Search grounding
- Threads 貼文設計為 SEO-friendly／可被索引 → grounding 可間接撈到公開貼文；相較 IG/FB，第三方對 Threads 索引覆蓋的具體數據**查不到**（未見權威量化）。來源：[seosherpa](https://seosherpa.com/social-becomes-search/)（提及 Threads 公開貼文可索引，未量化）。

### Q5 ToS / 法律風險
- **官方 API**：最低風險但功能窄（公開內容只有 keyword search，需 app review）。
- **無登入公開爬取**：同 Meta 系列原則，登出態公開資料相對可辯護；「合理速率、不造成損害」是第三方共識的安全線。來源：[Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-threads)。
- **登入態爬取**：最高風險（帳號封禁）。

---

## 5. ToS／法律風險分級（跨平台總表）

| 途徑 | 法律風險 | 主要風險點 | 依據 |
|---|---|---|---|
| **官方 API** | 最低 | 受 ToS/配額/開發者政策約束；資料範圍受限；FB/Threads 需 App Review | 各平台官方文件 |
| **無登入公開頁爬取** | 中（可辯護） | CFAA 不適用公開資料（hiQ）；Meta ToS 不約束登出態（Meta v. Bright Data）；但 IP 封鎖、訴訟成本高（hiQ 勝訴仍付 $500K 並倒閉） | [hiQ/ScrapeCreators](https://scrapecreators.com/blog/is-web-scraping-legal-a-guide-based-on-recent-court-ruling)、[Meta v. Bright Data/FBM](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/) |
| **登入態爬取** | **最高** | 各平台 ToS 明文禁止登入態自動化；帳號封禁即時且普遍；契約違反＋潛在 CFAA 曝險 | [SocialCrawl 法律技術指南](https://www.socialcrawl.dev/blog/social-media-scraping-legal-technical-guide) |

**附註**：EU AI Act 要求通用型 AI 揭露訓練資料來源/主要網域、尊重著作權 opt-out、禁止無差別臉部影像爬取。第三方服務（Apify/Bright Data）將爬取風險外包給服務商，是降低自身曝險的常見做法。

---

## 6. 每平台建議取得路徑（結論句＋理由）

- **YouTube**：**官方 Data API v3 為主（免費 10k units/日、1-unit 取 channel/video/stats/comments，完全合規）＋ 對重點影片用 Gemini 原生 YouTube URL 理解補「影片內容/描述」**；配額或搜尋不足時用 Apify/Bright Data actor 補。理由：官方 API 成本近乎零又合規，B2B 所需（訂閱數/影片清單/描述/發文頻率）幾乎全在 1-unit 呼叫內。
- **Facebook**：**第三方服務（Apify $2/1K posts、Bright Data $1.5/1K）為主 ＋ Gemini grounding 撈已被 Google 索引的公開專業粉專內容為輔；不自建無登入爬取、絕不登入態爬取**。理由：官方 PPCA 門檻高（App Review＋商業驗證），FB 三層反爬讓自建爬蟲最難維護，外包最省事且把風險外移。
- **Instagram**：**Gemini grounding（公開專業帳號 2025-07 起被 Google 索引）＋ 第三方 actor（Apify apidojo ~$0.5/1K，免登入免代理）為主；當對方是公開 Business/Creator 時，用官方 business discovery 補結構化 `followers_count` 等欄位**。理由：官方通用讀取受限、自建無登入爬取封鎖快成本高，第三方＋grounding 組合覆蓋最廣。
- **Threads**：**無登入 Playwright 爬公開 profile/post（資料在 `<script>` JSON）或第三方 actor 為主；官方 API 的 keyword search（需 app review）用於輿情關鍵字監測**。理由：官方無「抓他人整條時間軸」端點，但公開頁無登入可爬且封鎖較 FB/IG 寬鬆。

### 整體建議（可組合多途徑）
1. **YouTube 走「官方 API + Gemini」**（合規、便宜、深度）。
2. **Meta 三平台（FB/IG/Threads）走「第三方服務 + Gemini grounding」為主、官方 API 僅補結構化欄位**（避開 App Review 與反爬維運）。
3. **一律避免登入態爬取**（帳號封禁＋ToS/法律風險最高，且對「讀公開資料」無必要）。
4. **善用 2025-07 Google 索引 Meta 公開專業帳號的變化**：Gemini grounding 現在能間接撈到 IG/FB 公開專業內容，成本最低、風險最低，適合當第一道情報層，第三方服務當「要結構化欄位/高覆蓋」時的第二道。

---

## 來源清單（依平台）

**跨平台/法律/索引**
- Google 索引 Meta 內容：https://ppc.land/instagram-content-becomes-searchable-on-google-starting-july-10/ ／ https://verdemedia.com/blog/instagram-facebook-posts-indexed-in-google ／ https://www.boderia.io/insights/google-is-indexing-instagram-posts-what-you-must-know
- Meta v. Bright Data：https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/ ／ https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/ ／ https://www.socialmediatoday.com/news/meta-abandons-legal-case-data-scraping-losing-key-judgment/708538/
- hiQ/CFAA 與 ToS 風險：https://scrapecreators.com/blog/is-web-scraping-legal-a-guide-based-on-recent-court-ruling ／ https://www.socialcrawl.dev/blog/social-media-scraping-legal-technical-guide
- Gemini grounding：https://ai.google.dev/gemini-api/docs/google-search ／ Gemini YouTube URL 理解：https://ai.google.dev/gemini-api/docs/video-understanding
- Bright Data 社群定價：https://brightdata.com/products/web-scraper/social-media-scrape

**YouTube**
- 官方 Quota guide：https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- Quota Calculator：https://developers.google.com/youtube/v3/determine_quota_cost
- Channels 資源：https://developers.google.com/youtube/v3/docs/channels
- API ToS：https://developers.google.com/youtube/terms/api-services-terms-of-service ／ Developer Policies：https://developers.google.com/youtube/terms/developer-policies
- 配額調降：https://www.getphyllo.com/post/is-the-youtube-api-free-costs-limits-iv
- 無登入爬取實測：https://liveproxies.io/blog/how-to-scrape-youtube ／ https://scrapfly.io/blog/posts/how-to-scrape-youtube
- Apify YouTube Channel Scraper：https://apify.com/convertfleetdotonline/youtube-channel-scraper

**Facebook**
- 官方 PPCA：https://developers.facebook.com/docs/features-reference/page-public-content-access
- 無登入爬取實測：https://dev.to/vhub_systems_ed5641f65d59/how-to-scrape-facebook-public-data-without-the-graph-api-in-2026-4ack ／ https://scrapfly.io/blog/posts/how-to-scrape-facebook
- Apify Facebook Posts Scraper：https://apify.com/apify/facebook-posts-scraper
- Bright Data FB 評比：https://brightdata.com/blog/web-data/best-facebook-scrapers

**Instagram**
- 官方 Business Discovery：https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/
- 2026 API 指南：https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/ ／ https://storrito.com/resources/instagram-api-2026/
- 無登入爬取實測：https://scrapfly.io/blog/posts/how-to-scrape-instagram ／ https://www.socialcrawl.dev/blog/instagram-scraping-2026
- Apify apidojo：https://apify.com/apidojo/instagram-scraper ／ Apify 官方：https://apify.com/apify/instagram-scraper
- 合規：https://sociavault.com/blog/instagram-scraping-legal-2025

**Threads**
- 官方 Keyword Search：https://developers.facebook.com/docs/threads/keyword-search/
- 官方 API 更新：https://www.socialmediatoday.com/news/meta-updates-threads-api-with-more-third-party-app-integrations/817502/
- 無登入爬取實測：https://scrapfly.io/blog/posts/how-to-scrape-threads ／ https://www.threadify.app/blog/can-you-view-threads-without-an-account
- 第三方：https://sociavault.com/blog/scrape-threads-data-unofficial-api-2026 ／ https://apify.com/magicfingers/threads-scraper

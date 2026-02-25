# HotTalk HK 熱話 — Product Specification v2.3

> 香港首個免費跨平台社交媒體熱點聯合平台
>
> 文件版本：v2.3 (Final) | 日期：2026-02-25
>
> 作者：Yau (AI Studio HK)
>
> AI Review 輪次：5/5（GPT ✅✅✅ Gemini ✅ Claude ✅ — 全部完成）
>
> v2.2 → v2.3 變更（GPT 數學精度修正）：
>
> - 🔴 raw_engagement 口徑鎖死（每平台唯一定義）
> - 🔴 heat_score 改 INTEGER（防 float 排序不穩）
> - 🔴 跨時間事件防錯誤合併（72h+7d 強制新建）
> - 🟡 velocity 定義改良（防小樣本假高）
> - 🟡 seed 標記 + 排除 percentile 污染
> - 🟡 Nightly recluster SEO 穩定閘（>48h 禁 split）
> - 🟡 平台缺失時權重 re-normalize
> - 🟡 keywords fallback（TF-IDF 兜底）
> - 🟡 48h 查詢硬限制（所有 vector query 強制加）
> - 📄 新增獨立文件《Heat Score 數學定義 v1.0》
>
> v2.1 → v2.2 變更（GPT 最終壓力測試）：
>
> - 🔴 Incremental assign 加 top 300 active topics 上限（防隱形瓶頸）
> - 🟡 Centroid 每 20 posts full recompute（防數值漂移）
> - 🟡 Heat score Day 8-10 平滑過渡（防排名跳動）
> - 🟡 LIHKG 替代來源加入 Phase 1.5 roadmap
> - 🟡 冷啟動 seed 策略（確保首頁 > 10 topics）
> - 🟡 Topic status 自動轉換規則（防永遠 emerging）
> - 🟡 content_hash 改用 normalized_title（轉載去重）
> - 🟡 Admin review 改 top 20 + flagged（Solo dev 體力管理）
>
> v2.0 → v2.1 變更（Claude Self-Review）：
>
> - 🟡 Topics table 新增 centroid vector column（增量 assign 必須）
> - 🟡 Railway always-on + QStash retry 策略（cold start 對策）
> - 🟡 Embedding batch 優化（減少 API round-trip）
> - 🟡 Heat score bootstrap 策略（頭 7 日用 simple rank）
> - 🟡 Edge Function timeout 保護（AbortController 120s）
> - 🟡 Monitoring/alerting 具體方案（Redis error count → TG webhook）
>
> v1.0 → v2.0 變更（GPT + Gemini Review）：
>
> - 🔴 AI Pipeline 重新設計（獨立 Python Worker + 增量 assign + 夜間重聚類）
> - 🔴 Data Model 大幅補齊（scrape_runs, topic_posts, entities, content_hash）
> - 🔴 Sprint Plan 由 4 週改為 6 週
> - 🔴 Heat Score 重新定義（per-platform normalization）
> - 🟡 Topic 穩定性策略（slug alias, canonical_id, merge/split）
> - 🟡 降級模式設計（LIHKG 3 層、AI fallback）
> - 🟡 合規補齊（投訴機制、敏感字過濾、cost cap）
> - 🟡 API 改 cursor-based pagination + Hobby tier

-----

## 目錄

1. [Executive Summary](#1-executive-summary)
1. [Problem Statement & Market Gap](#2-problem-statement--market-gap)
1. [Product Vision & Positioning](#3-product-vision--positioning)
1. [Target Users & Personas](#4-target-users--personas)
1. [Core Features — MVP (Phase 1)](#5-core-features--mvp-phase-1)
1. [Feature Roadmap (Phase 2-4)](#6-feature-roadmap-phase-2-4)
1. [Information Architecture & UX Flow](#7-information-architecture--ux-flow)
1. [Data Sources & Acquisition Strategy](#8-data-sources--acquisition-strategy)
1. [AI Pipeline — Topic Clustering & Summarization (v2)](#9-ai-pipeline--topic-clustering--summarization-v2)
1. [Technical Architecture (v2)](#10-technical-architecture-v2)
1. [Data Model (v2)](#11-data-model-v2)
1. [API Design (v2)](#12-api-design-v2)
1. [Business Model & Monetization (v2)](#13-business-model--monetization-v2)
1. [Go-to-Market Strategy](#14-go-to-market-strategy)
1. [Legal & Compliance (v2)](#15-legal--compliance-v2)
1. [Development Sprint Plan (v2 — 6 Weeks)](#16-development-sprint-plan-v2--6-weeks)
1. [KPIs & Success Metrics](#17-kpis--success-metrics)
1. [Risk Register (v2)](#18-risk-register-v2)
1. [Resolved Questions (from v1 Review)](#19-resolved-questions-from-v1-review)
1. [Appendix](#20-appendix)

-----

## 1. Executive Summary

### 1.1 一句話定位

HotTalk HK 係香港版「今日熱榜 (tophub.today)」— 一個免費、即時、跨平台嘅社交媒體熱點聚合平台，讓 740 萬香港人只需打開一個網站，3 分鐘內掌握全港網絡熱話。

### 1.2 核心價值主張

|對象 |痛點 |HotTalk HK 解決方案 |
|---------------|-----------------------|--------------------------|
|普通網民 |每日碌 5+ 個 app 先知「今日講緊乜」 |一頁睇晒全港熱話，AI 自動歸納 |
|KOL / 自媒體 |唔知今日拍咩題材有流量 |即時 trending data + AI 爆紅預測|
|記者 / 編輯 |手動開 10+ 分頁追 trending |一個 dashboard 取代全部 |
|中小企 / Marketing|企業級 Social Listening 太貴|輕量級行業監控 $99-500/月 |

### 1.3 技術棧（v2 更新）

Frontend: Next.js 14+ (ISR + On-demand Revalidation) + Tailwind + shadcn/ui

Backend: Supabase (PostgreSQL + pgvector + Edge Functions + Auth + Realtime)

Cache: Upstash Redis (Cache + Rate Limit + Job Queue via QStash)

AI Worker: Railway (Python 3.11 FastAPI) — HDBSCAN clustering + sentiment

AI APIs: Claude Haiku (summarization) + OpenAI text-embedding-3-small (vectors)

Scheduler: Upstash QStash (替代 pg_cron，重試機制更完善)Hosting: Vercel (frontend) + Supabase Cloud + Railway + Upstash

### 1.4 月運營成本預估 (MVP)

|項目 |服務 |月費 (USD) |
|--------------|---------------------------|--------------------------|
|Frontend |Vercel Pro |$20 |
|Database |Supabase Pro |$25 |
|AI Worker |Railway (Python, always-on)|$5-10 |
|Cache/Queue |Upstash Redis + QStash |~$10 |
|AI Embedding |OpenAI |~$1 |
|AI Summary |Claude API |~$5 |
|Rotating Proxy|LIHKG 用 |~$30 |
|Domain |hottalk.hk |~$3 |
|**Total** | |**~$99-104/月 (~$780 HKD)**|

-----

## 2. Problem Statement & Market Gap

*(同 v1.0 — 此 Section 經兩輪 Review 確認無需修改)*

### 2.1 市場數據

- 香港總人口：740 萬
- 互聯網用戶：710 萬（滲透率 96%）
- 活躍社交媒體用戶：646 萬（86.2%）
- 平均每人同時使用 6.4 個社交平台
- 每日社交媒體使用時間：1.4 小時
- 46.4% 用戶透過社交媒體發現新品牌
- 社交媒體用戶身份 2024-2025 跌 4.8% → 進入存量博弈期

### 2.2 市場 Gap

$50,000+/月 │ Wisers / Meltwater / Brandwatch（企業級）

$2,000-5,000 │ K-Matrix / Cloudbreakr / SPL（中型）

│

$0-500/月 │ ██ 巨大真空地帶 ██ ← HotTalk HK

│

免費 │ 各平台自己嘅 Trending（割裂）

-----

## 3. Product Vision & Positioning

*(同 v1.0 — 此 Section 經兩輪 Review 確認無需修改)*

### 3.1 品牌定位

|維度 |定義 |
|-----------|-------------------------------------|
|**品牌名** |熱話 HotTalk HK |
|**域名** |hottalk.hk（首選）/ hottalkhk.com |
|**Tagline**|「一頁睇晒，全港熱話」 |
|**產品類型** |Consumer Web App (PWA) — Mobile First|
|**語言** |繁體中文為主，支援英文切換 |
|**調性** |快速、簡潔、無雜訊、中立客觀 |

### 3.2 核心差異化（護城河）

1. 跨平台 AI 話題聚類 — 識得將 LIHKG post + YouTube 影片 + HK01 新聞自動歸類
1. 廣東話語義引擎 — 識 HK slang + 同義詞標準化（港鐵↔MTR）
1. Consumer-first UX — 免費、無需登入、3 秒載入、Mobile PWA
1. Programmatic SEO — 每個熱話自動生成獨立 URL，搶佔 Google 搜索

-----

## 4. Target Users & Personas

*(同 v1.0 — 此 Section 經兩輪 Review 確認定義準確)*

|Persona|身份 |Tier |月費 |核心需求 |
|-------|-----------------|----------|----------|---------------------|
|阿明 |Office worker |Free |$0 |3 分鐘睇完今日重點 |
|Mia |KOL/Creator |Pro |$99-299 |Trending alert + 爆紅預測|
|Derek |Marketing Manager|Enterprise|$500-2,000|品牌監控 + 競品分析 |
|Rachel |記者/編輯 |Pro |$99 |Real-time dashboard |

-----

## 5. Core Features — MVP (Phase 1)

> v2 重大調整：砍走所有增長工具，MVP 只做「可信的熱話牆 + 穩定 topic page」

### 5.1 Feature 清單（v2 精簡版）

|ID |功能 |優先級 |v1→v2 變更 |
|-----|-------------------------|--------|----------------------------------|
|F1 |**全港熱話牆 (Trending Wall)**|P0 |保留 |
|F2 |**YouTube Trending HK** |P0 |保留 |
|F3 |**LIHKG 熱門摘要** |P0 |保留（加降級模式） |
|F4 |**新聞 RSS 聚合** |P0 |保留 |
|F5 |**Google Trends HK** |P0 |保留（降為加權信號） |
|F6 |**AI 話題聚類** |P0 |🔴 重新設計（增量 assign + 夜間重聚類） |
|F7 |**話題詳情頁 + SEO** |P0 |🟡 升級為 P0（SEO 係核心增長引擎） |
|F8 |**Admin Topic Review 頁** |P0 (NEW)|🆕 內部 QA 工具 |
|F9 |**內容報告/下架機制** |P0 (NEW)|🆕 合規必備 |
|~F8~ |~Threads Trending~ |~P1~ |🔴 延後到 Phase 2（改 keyword_search 回填）|
|~F9~ |~搜尋功能~ |~P1~ |🔴 延後到 Phase 2 |
|~F10~|~Telegram Bot~ |~P1~ |🔴 延後到 Phase 2 |
|~F11~|~PWA~ |~P1~ |🔴 延後 |
|~F12~|~Dark Mode~ |~P2~ |延後 |

### 5.2 F1: 全港熱話牆 (Trending Wall)

┌──────────────────────────────────────────────────────┐│ 🔥 熱話 HotTalk HK 更新於 3 分鐘前│

│ 一頁睇晒，全港熱話 │

├──────────────────────────────────────────────────────┤

│ [🔥全部] [📺YouTube] [💬連登] [📰新聞] [🔍Google] │

├──────────────────────────────────────────────────────┤

│ │

│ 🔴 熱話 #1 🔥🔥🔥🔥🔥 (9,832 ↗) │

│ ┌──────────────────────────────────────────────┐ │

│ │ 港鐵觀塘線嚴重延誤 │ │

│ │ │

│ │ 📺3 💬5 📰4 🔍+340% │ │

│ │ │

│ │ AI: 港鐵觀塘線今朝8點因信號故障全線停駛，大 │ │

│ │ 量打工仔遲到... [展開] │ │

│ │ │

│ │ 😤 72% 負面 😐 20% 中立 😊 8% 正面 │ │

│ │ [⚠️報告] │ │

│ └──────────────────────────────────────────────┘ │

│ │

│ 📊 --- Native Ad Slot --- │

│ │

│ 🔴 熱話 #2 ... │

└──────────────────────────────────────────────────────┘

v2 設計變更：

- 熱度改用「分級 🔥 + 小字數字」（Gemini: 數字有比較感 / GPT: 分級易讀 → 兩者兼用）
- AI 摘要預設只顯示 2 行，點入 topic page 先完整顯示
- 加「更新於 X 分鐘前」新鮮度標籤
- 加「⚠️ 報告」按鈕（合規必備）
- 每 3-5 個 card 插 ad slot

### 5.3 F8 (NEW): Admin Topic Review 頁

URL: /admin/topic-review（只有 admin 可見）

功能：

- 每日 smart 抽樣（v2.2 改進，唔再固定 50）:

  → heat_score top 20 topics（最多人睇到，出錯影響最大）

  → 所有 flagged topics (suspected_spam, reported)

  → 預計每日 review 量: 20-35 個（Solo dev 可持續）

- 顯示 cluster 內所有 posts
- 操作：✅ 確認 | 🔀 合併到其他 topic | ✂️ 拆分 | 🗑️ 標記 spam
- 每個操作記錄 audit_log
- 生成 AI pipeline quality metrics（precision、merge rate）

目的：建立評測數據，持續優化 clustering 質量

### 5.4 F9 (NEW): 內容報告/下架機制

用戶操作：

話題 card / 話題詳情頁 → 點「⚠️ 報告內容錯誤」 → 選擇原因：

□ AI 摘要不準確

□ 話題合併錯誤（應該係兩件不同嘅事）

□ 包含個人私隱

□ 包含不當內容

□ 其他

系統處理：

- 被舉報 ≥3 次 → 自動隱藏 AI 摘要（保留標題+連結）
- 被舉報 ≥5 次 → 自動下架整個 topic
- 所有操作記錄到 content_reports table
- 每日 admin review 被報告嘅 topics

-----

## 6. Feature Roadmap (Phase 2-4)

### Phase 1.5: LIHKG 替代來源緩衝（Week 6-7, NEW v2.2）

> 目的：降低對 LIHKG 單一灰色來源嘅產品依賴（佔熱話價值 30-40%）

|ID |功能 |難度|說明 |
|----|----------------------|--|---------------------------------|
|F10a|YouTube HK 高留言影片抓取 |低 |已有 YouTube API，加 comment_count 排序|
|F10b|HK Facebook 公開 Page 監控|中 |新聞/媒體 Page（HK01、100毛等）公開 posts |
|F10c|Dcard HK 板 trending |中 |有非官方 API，metadata only |

### Phase 2: Pro 版 + 增長工具（Week 8-11）

|ID |功能 |
|---|-------------------------------------------|
|F10|Telegram Bot（每日推送 + keyword subscribe） |
|F11|搜尋功能（pg_trgm typo tolerance + 同義詞） |
|F12|Threads keyword_search 回填（唔係 trending list）|
|F13|用戶註冊/登入（Supabase Auth） |
|F14|Pro 訂閱（Stripe $99/$299） |
|F15|自訂 Keyword Alert（Pro 功能） |
|F16|歷史趨勢圖表 |
|F17|每日懶人包 Auto-post（IG/Threads 圖片生成） |

### Phase 3: B2B + API（Week 11-14）

|ID |功能 |
|---|--------------------------------------|
|F18|Public API v1（cursor-based pagination）|
|F19|X/Twitter HK（Piloterr） |
|F20|品牌監控 Dashboard（Enterprise） |
|F21|Affiliate 消費熱榜（Klook/KKday） |

### Phase 4: AI 工具矩陣（Week 15+）

|ID |功能 |
|---|------------------------|
|F22|AI 熱話寫稿助手 |
|F23|小紅書 / TikTok 接入 |
|F24|Auto Weekly Report (PDF)|
|F25|Discord Bot |

-----

## 7. Information Architecture & UX Flow

### 7.1 Sitemap (v2)

hottalk.hk/

├── / # 首頁 — 全港熱話牆 (AI 聚合優先)

├── /platform/youtube # YouTube Trending HK

├── /platform/lihkg # LIHKG 熱門

├── /platform/news # 新聞聚合

├── /platform/google-trends # Google 趨勢

├── /topic/[slug] # 話題詳情頁 (Programmatic SEO)

├── /trending/[date] # 歷史日期熱話 (SEO 長尾頁)├── /about # 關於我們

├── /privacy # 私隱政策

├── /terms # 使用條款

├── /report # 內容舉報指引

├── /admin/topic-review # 管理員 Topic QA (需 admin auth)

│

│ Phase 2+:

├── /search?q=xxx # 搜尋

├── /pro # Pro 版介紹

├── /dashboard/ # Pro Dashboard

└── /api/v1/ # Public API

v2 SEO 策略調整（GPT feedback）：

- Topic slug **唔用日期**：`/topic/mtr-kwun-tong-line-delay`

  （唔係 `/topic/mtr-delay-20260225`）

  → 將來再有同類事件可以 reuse URL，累積 SEO 權重

- 加 topics.canonical_id + topic_aliases table 處理 merge/split 嘅 301 redirect

- robots.txt：Block /admin`、`/api`、`/search`，集中 SEO 權重去 `/topic 同 /trending

- Block GPTBot/CCBot 等 AI 爬蟲（保護數據資產）

### 7.2 核心 User Flow

SEO 入口 (主要增長引擎):

Google 搜「港鐵故障」 → 命中 /topic/mtr-kwun-tong-line-delay (ISR + OG card)

→ 睇到跨平台聚合內容 → Bookmark hottalk.hk → 成為 DAU

直接訪問:

每日打開 hottalk.hk → 3 秒內見到今日 Top 10 熱話 → 掃一眼

→ 有興趣先 click 入 topic page → AI 聚合優先 tab → 平台 tab 作次級入口

-----

## 8. Data Sources & Acquisition Strategy

### 8.1 MVP 數據源優先級（v2 調整）

|優先級 |平台 |可行性 |方法 |MVP 角色 |
|------|-------------------|-----|---------------------------|---------------|
|🥇 P0 |YouTube Trending HK|5/5 |官方 Data API v3 |主要來源 |
|🥇 P0 |新聞 RSS |5/5 |原生 RSS + RSSHub (自架) |主要來源 |
|🥇 P0 |Google Trends HK |5/5 |pytrends + SerpApi fallback|**加權信號**（非觸發條件）|
|🥈 P0 |LIHKG 熱門 |3/5 ⬇️|非官方 API + 3 層降級 |主要來源（接受不穩） |
|🔵 P1.5|Threads |4/5 |keyword_search 回填 ⬇️ |唔係「熱門榜」 |

v2 關鍵調整：

1. **LIHKG 可行性降為 3/5**（GPT + Gemini 一致認為 4/5 過份樂觀）
1. Google Trends 定位改為「加權信號」 — 因為 pytrends 延遲 12-24h，唔能作為即時觸發
1. Threads 改為 keyword_search 回填 — 官方 API 無提供全局 trending list
1. RSSHub 改為自架 — 公共實例穩定性不足

### 8.2 LIHKG 3 層降級策略（NEW）

L1 正常模式:

- 抓取方式: 非官方 API (proxy A)
- 頻率: 每 10 分鐘
- 數據: threadId, title, replyCount, likeCount, dislikeCount
- Timeout: AbortController 120s（Edge Function limit ~150s）
- 觸發降級: 連續 3 次 403/429 OR 連續 2 次 timeout

L2 降級模式:

- 抓取方式: 降低頻率 + 切換 proxy B
- 頻率: 每 30 分鐘
- 數據: 同 L1
- 觸發降級: proxy B 亦被封

L3 最低模式:

- 抓取方式: 只抓 hot list 頁面連結與標題 (simple HTTP)
- 頻率: 每 60 分鐘
- 數據: title + url only
- 標記: data_quality = 'degraded'
- UI: LIHKG tab 顯示「數據更新較慢」提示

所有模式都記錄到 scrape_runs table（狀態碼、耗時、proxy_id）

### 8.3 各平台抓取詳細規格

#### YouTube Trending HK

方法: YouTube Data API v3

Endpoint: GET /youtube/v3/videos?chart=mostPopular&regionCode=HK&maxResults=50

Quota: 10,000 units/day (list = ~3 units/call)

頻率: 每 15 分鐘

成本: 免費

法律: 完全合規

#### 新聞 RSS

方法: 自架 RSSHub + 原生 RSS

來源: HK01, SCMP, 明報, 東網, 星島, 經濟日報, 有線新聞, 信報

頻率: 每 5 分鐘

數據: title, link, pubDate, source, description, imageUrl

成本: 免費（自架 RSSHub on Railway ~$5/月）

法律: 低風險（僅標題+摘要+導向原文）

去重: canonical_url 去除 tracking params

#### Google Trends HK

方法: pytrends (primary) + SerpApi (fallback, $50/月)

數據: keyword, traffic_volume, related_queries

頻率: 每 30 分鐘

角色: heat_score 加權信號（唔係即時觸發）

注意: pytrends 延遲 12-24h，只用作「話題破圈」驗證

#### LIHKG 熱門

方法: 非官方 API + Rotating Residential Proxy

頻率: L1=10min, L2=30min, L3=60min

數據: metadata only (title, counts, url)

存儲策略: content_policy = 'metadata_only'（唔存全文）

成本: Proxy ~$20-50/月

法律: 灰色地帶（需要降級方案 + 投訴流程）

-----

## 9. AI Pipeline — Topic Clustering & Summarization (v2)

> v2 核心重新設計：「增量 Assign + 夜間重聚類」兩段式策略
>
> 解決 v1 三大問題：(1) Deno 跑唔到 Python (2) Topic 不穩定 (3) SEO slug 漂移

### 9.1 Pipeline 總覽 (v2)

┌─────────────────────────────────────────────────────────────┐

│ DATA COLLECTION │

│ Supabase Edge Functions (Deno/TS) │

│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │

│ │YouTube API│ │LIHKG Scrp│ │News RSS │ │G.Trends │ │

│ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │

│ └──────┬──────┘──────┬─────┘──────┬──────┘ │

│ ▼ ▼ ▼ │

│ raw_posts table (Supabase PostgreSQL) ││

+ scrape_runs table (audit) │

└──────────────────────────┬──────────────────────────────────┘

│ QStash webhook trigger (每 10 分鐘) │

┌──────────────────────────▼──────────────────────────────────┐

│ AI WORKER (Railway — Python 3.11) │

│ │

│ ┌─────────────────────────────────────────────────────┐ │

│ │ MODE A: 增量 Assign (每 10 分鐘) │ │

│ │ │ │

│ │ 1. 拉取未處理嘅 new raw_posts │ │

│ │ 2. Entity normalization（港鐵→MTR(港鐵)） │ │

│ │ 3. OpenAI embedding (text-embedding-3-small, batch) │ │

│ │ 4. 搜索近 24h active topics 嘅 centroid vectors │ │

│ │ → ⚠️ 上限 300 topics (v2.2): │ │

│ │ WHERE status IN ('emerging','rising','peak') │ │

│ │ AND last_updated_at > NOW() - 24h │ │

│ │ ORDER BY heat_score DESC LIMIT 300 │ │

│ │ → centroid = mean(assigned posts embeddings) │ │

│ │ → 增量更新: new_centroid = (old × n + new) / (n+1)│ │

│ │ → ⚠️ 防漂移 (v2.2): 每 20 posts full recompute │ │

│ │ if centroid_post_count % 20 == 0: │ │

│ │ centroid = mean(ALL topic_posts embeddings) │ │

│ │ 5. cosine_similarity > THRESHOLD (0.78-0.85) │ │

│ │ → 符合: assign 到 existing topic │ │

│ │ → ⚠️ 跨時間事件保護 (v2.3 NEW): │ │

│ │ if topic.last_updated > 72h │ │

│ │ AND topic.first_detected > 7d: │ │

│ │ 強制新建 topic（避免復活舊 topic 混新事故） │ │

│ │ → 唔符合: 暫標為 unassigned │ │

│ │ 6. 檢查 unassigned posts 互相嘅 similarity │ │

│ │ → 若 ≥3 posts 且 source_diversity ≥ 2 平台 │ │

│ │ → 創建新 topic │ │

│ │ 7. 更新 heat_score │ │

│ │ 8. 新 topic → Claude Haiku 生成摘要/情感/slug │ │

│ │ 9. 寫回 Supabase (topics, topic_posts, raw_posts) │ │

│ │ 10. Trigger Vercel on-demand revalidation │ │

│ └─────────────────────────────────────────────────────┘ │

│ │

│ ┌─────────────────────────────────────────────────────┐ │

│ │ MODE B: 夜間重聚類 (每日 02:00 HKT) │ │

│ │ │ │

│ │ 1. 拉取近 48h 所有 posts + embeddings │ │

│ │ 2. HDBSCAN clustering (full batch) │ │

│ │ 3. 同現有 topics 做 reconciliation: │ │

│ │ - 新 cluster 匹配到現有 topic → 保留 slug │ │

│ │ - 兩個 topics 應合併 → merge (canonical_id) │ │

│ │ - 一個 topic 應拆分 → split (新 slug + alias) │ │

│ │ ⚠️ SEO 穩定閘 (v2.3 NEW): │ │

│ │ - topic_age < 24h → 允許 split │ │

│ │ - topic_age > 48h → 禁止 split（只 merge + 301） │ │

│ │ - 避免 Google 覺得 URL 不穩定 │ │

│ │ 4. 更新 topic_aliases (301 redirect) │ │

│ │ 5. 重新計算所有 heat_scores │ │

│ │ 6. 生成 quality metrics (precision, merge_rate) │ │

│ └─────────────────────────────────────────────────────┘ │

│ │

│ ┌─────────────────────────────────────────────────────┐ │

│ │ SAFETY CONTROLS │ │

│ │ - LLM daily token hard cap: 500K tokens/day │ │

│ │ - 超過 → 停止生成新摘要，保留標題+連結 │ │

│ │ - Sensitive keyword filter (JSON blacklist) │ │

│ │ - PII regex filter (電話/身分證/住址) │ │

│ │ - AI down → fallback: 顯示 raw titles (no summary) │ │

│ │ - ⚠️ 48h 查詢硬限制 (v2.3 NEW): │ │

│ │ 所有 vector scan / percentile / assign query 強制: │ │

││ │ WHERE published_at > NOW() - INTERVAL '48 hours' │ │

│ │ 唔准例外。防止數據膨脹後變隱形瓶頸。 │ │

│ └─────────────────────────────────────────────────────┘ │

└──────────────────────────────────────────────────────────────┘

### 9.2 Entity Normalization（NEW — 解決跨語言聚類問題）

-- entities table: 同義詞/實體標準化

-- 解決「港鐵觀塘線死咗」同「MTR Kwun Tong Line failure」無法聚類嘅問題

CREATE TABLE entities (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

canonical TEXT NOT NULL, -- 'MTR(港鐵)'

aliases TEXT[] NOT NULL, -- ['港鐵', 'MTR', 'mtr', '地鐵']

category TEXT, -- 'transport' | 'location' | 'person' | 'org'

created_at TIMESTAMPTZ DEFAULT NOW()

);

-- 常用 entities 初始數據

INSERT INTO entities (canonical, aliases, category) VALUES

('MTR(港鐵)', '{"港鐵","MTR","mtr","地鐵","港鐵公司"}', 'transport'),

('觀塘線', '{"觀塘綫","Kwun Tong Line","KTL"}', 'transport'),

('深圳', '{"Shenzhen","SZ","大陸"}', 'location'),

('LIHKG(連登)', '{"連登","LIHKG","lihkg","連豬"}', 'platform'),

('政府', '{"特區政府","港府","HK Government","HKSAR"}', 'org');

-- Embedding 前嘅 normalize 流程:

-- 1. 掃描 title + description

-- 2. 將 aliases 替換為 canonical

-- 3. 結果用於 embedding 計算

-- 4. 原文保留不變（只影響 vector）

### 9.3 Embedding 規格

模型: OpenAI text-embedding-3-small

維度: 1536

成本: $0.02 / 1M tokens ≈ $0.005/日

輸入策略 (v2 改進):

- v1: 只用 title
- v2: title + description (前 200 chars) + entity-normalized version
- 理由 (GPT Q13): 單憑標題 vector 距離可能太遠，加長 context 增加語義交集

Batch 優化 (v2.1 NEW):

- 唔好逐個 post call embedding API
- 每 10 分鐘 incremental job 開始時，一次過 batch embed 所有 pending posts
- OpenAI embedding API 支援 batch input（最多 2048 texts/call）
- 預期每次 batch: 20-100 posts → 1 次 API call → 減少 round-trip 99%
- 失敗處理: batch 失敗 → fallback 逐個 embed → 全部失敗 → 標記 no_ai

存儲: Supabase pgvector column

Index: MVP 先用順序掃描 (只查 24h 窗口)，Phase 2 再建 ivfflat index

### 9.4 Topic Creation 條件（v2 — 防假熱話）

新 Topic 創建條件（必須同時滿足）:

✅ min_cluster_size ≥ 3 (至少 3 個 post)

✅ source_diversity ≥ 2 (至少 2 個不同平台)

例外規則（新鮮但小樣本）:

✅ news + google_trends 同時出現（即使只有 2 posts）

→ 創建 topic 但標記 status = 'emerging'

防 Spam 三層防護:

1. 來源層: source_trust_weight (news=1.0, youtube_verified=0.8, lihkg_new_user=0.3)
2. 行為層: velocity 異常偵測（短時間暴增+來源單一 → 降權）
3. 內容層: 同 cluster 內文本 cosine > 0.95 → 視為 spam cluster

→ topics.flags = ['suspected_spam']，UI 隱藏

### 9.4b Topic Status 自動轉換規則（v2.2 NEW）

# 每次 heat_score 更新後自動判斷 topic.status

# 防止 topic 永遠停留在 'emerging'


def update_topic_status(topic: Topic) -> str:

hours_alive = hours_since(topic.first_detected_at)

velocity = calculate_velocity(topic) # 1h_posts / 6h_posts

# emerging → rising: 有足夠 engagement 且跨平台

if topic.status == 'emerging':

if topic.post_count >= 5 and topic.source_count >= 2:

return 'rising'

if hours_alive > 6 and topic.post_count < 3:

return 'archive' # 6h 仍只有 <3 posts → 唔係真熱話

# rising → peak: heat_score 進入當日 top 10%

if topic.status == 'rising':

if topic.heat_score >= get_percentile(90): # p90 of today's topics

topic.peak_at = now()

return 'peak'

if velocity < 0.2: # 幾乎無新 posts

return 'declining'

# peak → declining: velocity 跌 50% 或離開 p90

if topic.status == 'peak':

if velocity < 0.5 or topic.heat_score < get_percentile(70):

return 'declining'

# declining → archive: 72h 無新 post

if topic.status == 'declining':

if hours_since(topic.last_updated_at) > 72:

return 'archive'

return topic.status # 唔變

# Cron: 每次 incremental assign 完成後跑一次

# archive topics 唔再參與 centroid compare（節省算力）

### 9.5 AI Summarization (v2)

觸發: 新 topic 創建 OR existing topic 新增 ≥5 posts

模型: Claude 3.5 Haiku (快+平)

成本: ~50 clusters/日 × ~500 tokens = $0.02/日

Hard Cap: 500K tokens/日（超過停止摘要，保留標題+連結）

Prompt Template (v2):

---

你是香港社交媒體熱話分析師。以下是來自不同平台嘅帖文，全部講緊同一件事。

帖文列表：

{cluster_posts_titles_and_snippets}

請用繁體中文（香港用語）回覆，**嚴格按以下 JSON 格式**輸出：

{

"title": "（10-20字，簡潔概括事件）",

"summary": "（50字以內，用香港人嘅語氣，唔好直接抄任何原文）",

"sentiment": {"positive": 0.08, "negative": 0.72, "neutral": 0.15, "controversial": 0.05},

"keywords": ["港鐵", "觀塘線", "故障"],

"slug_suggestion": "mtr-kwun-tong-line-delay"

}

注意：

- summary 必須係你自己嘅概括，唔好複製原文句子
- sentiment 四個值加起來必須等於 1.0
- keywords 最多 5 個
- slug 用英文，全小寫，dash 分隔，唔加日期

---

Validation:

- Parse JSON → 失敗 → retry 1 次 → 仍失敗 → 只用第一個 post 嘅 title 作為 topic title
- sentiment 唔加起來等於 1.0 → normalize
- slug 撞到 → append short hash (例如 mtr-kwun-tong-line-delay-a3f2)
- keywords 空/缺 → fallback: 詞頻 top 3（掃 cluster titles+snippets）(v2.3 NEW)

不可留空，SEO metadata 依賴此欄位

### 9.6 Heat Score 計算 (v2.3 — 數學定義鎖死)

> 完整數學定義見獨立文件《HOTTALK-HEAT-SCORE-MATH-v1.0.md》
>
> 以下為 code-level 實現。所有口徑必須同獨立文件一致。

# v2.3: 鎖死 raw_engagement 口徑 + INTEGER 輸出 + 平台缺失處理

# ============================================

# STEP 0: Per-platform raw_engagement 定義（唯一口徑，唔可以改）

# ============================================


def get_raw_engagement(platform: str, posts: List[Post]) -> float:

""" 每個平台嘅 raw_engagement 定義。

platform_daily_stats 同 heat_score 必須用同一條公式。

"""

if platform == 'youtube':

# view_count_delta_24h（避免舊片永久佔優）

return sum(p.view_count_delta_24h for p in posts)

elif platform == 'lihkg':

# 淨 like + reply_count

return sum((p.like_count - p.dislike_count) + p.comment_count for p in posts)

elif platform == 'news':

# source_trust_weight 加總

return sum(get_source_weight(p.author_name) for p in posts)

elif platform == 'google_trends':

# 最高 traffic_volume

return max((p.view_count for p in posts), default=0)

return 0

# ============================================

# STEP 1: Per-platform percentile scoring

# ============================================


def calculate_heat_score(topic: Topic, posts: List[Post]) -> int:

""" 返回 INTEGER 0-10000（v2.3: 唔再用 float） """

platform_scores = {}

active_platforms = []

for platform, platform_posts in group_by_platform(posts):

raw = get_raw_engagement(platform, platform_posts)

score = percentile_rank_7d(platform, raw)

platform_scores[platform] = score

active_platforms.append(platform)

# ============================================

# STEP 2: 平台缺失時權重 re-normalize (v2.3 NEW)

# ============================================

base_weights = {

'engagement': 0.30,

'source_diversity': 0.25,

'velocity': 0.25,

'trends_signal': 0.10,

'recency': 0.10,

}

# 若某平台 6h 無數據 → 移除 trends_signal 權重，redistribute

if 'google_trends' not in active_platforms:

orphan = base_weights.pop('trends_signal', 0)

total = sum(base_weights.values())

base_weights = {k: v / total for k, v in base_weights.items()} # re-normalize to 1.0

weights = base_weights

# ============================================

# STEP 3: 合成

# ============================================

engagement = mean(platform_scores.values()) if platform_scores else 0

diversity = min(len(active_platforms) / 4.0, 1.0)

velocity = calculate_velocity(topic)

trends = platform_scores.get('google_trends', 0)

recency = math.exp(-0.05 * hours_since(topic.first_detected_at))

raw_score = (

weights.get('engagement', 0) * engagement +

weights.get('source_diversity', 0) * diversity +

weights.get('velocity', 0) * velocity +

weights.get('trends_signal', 0) * trends +

weights.get('recency', 0) * recency

)

return int(round(raw_score * 10000)) # v2.3: INTEGER，唔再 float

# ============================================

# STEP 4: Velocity 定義 (v2.3 改良 — 防小樣本假高)

# ============================================


def calculate_velocity(topic: Topic) -> float:

""" v2.3: 用 Option B（MVP 更穩）

velocity = min(1.0, posts_1h / 3)

解釋：1 小時內有 3+ 新 posts 就算「滿速」

避免只有 1 post 就得到 velocity=1.0 嘅假高問題

"""

posts_1h = count_posts_since(topic, hours=1)

return min(1.0, posts_1h / 3.0)

# ============================================

# STEP 5: Percentile with bootstrap + smooth transition

# ============================================


def percentile_rank_7d(platform: str, value: float) -> float:

""" v2.1 Bootstrap: Day 1-7 用 simple rank

v2.2 平滑過渡: Day 8-10 blend

v2.3 排除 seed: WHERE data_quality != 'seed'

"""

days = get_days_since_launch()

if days <= 7:

return simple_rank_today(platform, value)

percentile = percentile_rank_rolling(

platform,

value,

extra_where="AND data_quality != 'seed'" # v2.3: 排除 seed 污染

)

if days <= 10: # v2.2: 平滑過渡

blend = min(1.0, (days - 7) / 3.0)

simple = simple_rank_today(platform, value)

return (1 - blend) * simple + blend * percentile

return percentile

### 9.7 Graceful Degradation 策略（NEW）

情況 1: OpenAI Embedding API down

→ 新 posts 暫不計算 embedding

→ 顯示 raw platform trending（YouTube/LIHKG 各自嘅排行）

→ 標記 data_quality = 'no_ai'

情況 2: Claude API down

→ 停止生成新 topic summary

→ 新 topic 用「第一個 post 嘅 title」作為 topic title

→ AI 摘要位置顯示「摘要生成中...」

情況 3: LIHKG 被完全封鎖

→ L3 模式（只顯示連結）或完全移除 LIHKG tab

→ 其他平台照常運作

情況 4: LLM token cap 超標

→ 停止生成摘要，保留標題 + 連結 + 各平台數據

→ admin alert via email/TG

### 9.8 Monitoring & Alerting 方案（v2.1 NEW）

架構: Upstash Redis (error counters) + QStash (webhook to TG)

┌─────────────────────────────────────────────┐

│ 每個 collector / AI job 完成後: │

│ 成功 → INCR hottalk:ok:{collector}:{date} │

│ 失敗 → INCR hottalk:err:{collector}:{date}│

│ │

│ QStash 每 30 分鐘跑 alert check: │

│ IF err_count > threshold │

│ → POST webhook to Telegram Bot │

│ → 附帶: collector name, error count, last │

│ error message │

└─────────────────────────────────────────────┘

Alert 閾值:

- Collector 連續失敗 ≥ 5 次 → ⚠️ TG alert
- LIHKG 降級到 L3 → ⚠️ TG alert
- LLM daily cost > $0.08 → ⚠️ TG alert
- LLM daily cost > $0.15 → 🔴 TG alert + auto hard stop
- AI Worker (Railway) healthcheck fail → 🔴 TG alert
- 0 new topics in 6h → ⚠️ TG alert (可能全線故障)

Dashboard (MVP 最簡版):

- /admin/status 頁面
- 顯示: 各 collector 最近 24h 成功/失敗次數
- 顯示: 今日 LLM token usage + cost
- 顯示: 各平台最後成功抓取時間
- 數據來源: Redis counters + scrape_runs table

-----

## 10. Technical Architecture (v2)

### 10.1 系統架構圖 (v2)

┌─────────────────────────────────────────────────────────────────┐

│ CLIENT LAYER │

│ ┌──────────────────────────────────────────────────────────┐ │

│ │ Next.js 14 (App Router) │ │

│ │ ISR (revalidate=300) + On-demand Revalidation │ │

│ │ Vercel CDN (Edge) │ │

│ │ Mobile-first PWA │ │

│ └──────────────────────┬───────────────────────────────────┘ │

├─────────────────────────┼───────────────────────────────────────┤

│ │ │

│ ┌──────────────────────▼──────────────────────────────────┐ │

│ API LAYER (Next.js API Routes / Vercel) │ │

│ - /api/revalidate (webhook from AI worker) │ │

│ - /api/v1/* (Public API — Phase 3) │ │

│ └──────────┬───────────────────────────┬──────────────────┘ │

│ │ │ │

│ ┌──────────▼───────┐ ┌──────────────▼──────────────────┐ │

│ Supabase │ │ Upstash │ │

│ PostgreSQL │ │ Redis (Cache) │ │

│ + pgvector │ │ QStash (Scheduler/Webhook) │ │

│ + Auth │ │ Ratelimit │ │

│ + Storage │ │ │

│ └──────────────────┘ └─────────────────────────────────┘ │

│ │

├─────────────── SEPARATED COMPUTE ───────────────────────────────┤

│ ││ ┌──────────────────────────────────────────────────────────┐ │

│ │ DATA COLLECTORS (Supabase Edge Functions — Deno/TS) │ │

│ │ Triggered by QStash on schedule │ │

│ │ │ │

│ │ • youtube_collector (every 15 min) │ │

│ │ • news_rss_collector (every 5 min) │ │

│ │ • lihkg_collector (every 10 min, 3-tier degraded) │ │

│ │ • google_trends_collector (every 30 min) │ │

│ │ │ │

│ │ → Write to: raw_posts + scrape_runs │ │

│ └──────────────────────────────────────────────────────────┘ │

│ │

│ ┌──────────────────────────────────────────────────────────┐ │

│ │ AI WORKER (Railway — Python 3.11 FastAPI) │ │

│ │ Triggered by QStash webhook │ │

│ │ │ │

│ │ POST /jobs/incremental-assign (every 10 min) │ │

│ │ POST /jobs/nightly-recluster (daily 02:00 HKT) │ │

│ │ POST /jobs/health (healthcheck) │ │

│ │ │ │

│ │ ⚙️ Railway Config: │ │

│ │ - Always-on: true (~$5/月, 避免 cold start 10-30s) │ │

│ │ - Memory: 512MB (HDBSCAN 夜間需要) │ │

│ │ - QStash retry: 3 次, backoff 30s/60s/120s │ │

│ │ │ │

│ │ Dependencies: hdbscan, numpy, sklearn, openai, anthropic│ │

│ │ → Read/Write: Supabase (via supabase-py) │ │

│ │ → Trigger: Vercel on-demand revalidation │ │

│ └──────────────────────────────────────────────────────────┘ │

└─────────────────────────────────────────────────────────────────┘

### 10.2 關鍵技術決策 (v2 更新)

|決策點 |v1 |v2 |變更理由 |
|--------------|-------------------|------------------------------------|--------------------|
|AI Pipeline 執行|Supabase Edge |**Railway (Python)** |🔴 Deno 跑唔到 Python ML|
|Clustering 策略 |每 10min HDBSCAN 全量 |**增量 assign + 夜間 HDBSCAN** |🔴 Topic 穩定性 |
|Scheduler |pg_cron |**Upstash QStash** |🟡 更好嘅重試機制 |
|Embedding 輸入 |title only |**title + desc + entity normalized**|🟡 提升跨語言聚類 |
|ISR 策略 |revalidate=300 only|**ISR + on-demand revalidation** |🟡 大更新即時反映 |
|Topic slug |含日期 |**不含日期** |🟡 SEO reuse |
|Vector index |ivfflat |**MVP 先順序掃描** |🟡 數據量未到需要 index |
|Heat score |簡單加權 |**Per-platform percentile 合成** |🔴 跨平台不可比 |

### 10.3 Cron Schedule (v2 — via QStash)

每 5 分鐘: news_rss_collector

每 10 分鐘: lihkg_hot_collector (3 層降級)

每 10 分鐘: ai_incremental_assign (Railway webhook)

每 15 分鐘: youtube_trending_collector

每 30 分鐘: google_trends_collector

每日 02:00: ai_nightly_recluster (Railway webhook)

每日 03:00: data_cleanup (清理 >30 日 raw data embedding)

每日 04:00: platform_daily_stats_snapshot (heat score 正規化用)

-----

## 11. Data Model (v2)

> v2 重大補齊：scrape_runs, topic_posts, entities, topic_aliases, content_reports, system_logs

-- ============================================

-- 1. RAW POSTS — 各平台抓取嘅原始數據 (v2)

-- ============================================

CREATE TABLE raw_posts (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

platform TEXT NOT NULL,

platform_id TEXT NOT NULL,

title TEXT NOT NULL,

description TEXT,

url TEXT NOT NULL,

canonical_url TEXT, -- 🆕 去除 tracking params

content_hash TEXT, -- 🆕 SHA-256(normalized_title) 去重

-- v2.2: 唔再用 title+source+published_at

-- 因為轉載新聞 published_at 不同但內容相同

-- normalized = lowercase + strip punctuation + trim

thumbnail_url TEXT,

author_name TEXT,

author_id TEXT,

-- Engagement

view_count BIGINT DEFAULT 0,

view_count_delta_24h BIGINT DEFAULT 0, -- v2.3: YouTube 24h 增量（避免舊片永久佔優）

like_count INTEGER DEFAULT 0,

dislike_count INTEGER DEFAULT 0,

comment_count INTEGER DEFAULT 0,

share_count INTEGER DEFAULT 0,

-- AI Processing

embedding vector(1536),

normalized_text TEXT, -- 🆕 entity-normalized 版本

processing_status TEXT DEFAULT 'pending', -- 🆕 'pending'|'embedded'|'assigned'|'noise'

-- Scraping Metadata

scrape_run_id UUID REFERENCES scrape_runs(id), -- 🆕

content_policy TEXT DEFAULT 'metadata_only', -- 🆕 'metadata_only'|'full_text'

data_quality TEXT DEFAULT 'normal', -- 🆕 'normal'|'degraded'|'no_ai'|'seed'(v2.3)

-- Timestamps

published_at TIMESTAMPTZ NOT NULL,

collected_at TIMESTAMPTZ DEFAULT NOW(),

UNIQUE(platform, platform_id)

);

-- Partition by month (v2 — 解決數據膨脹)

-- 實際操作：每月初 create 新 partition，pg_cron 自動 drop >3 月嘅 partition

-- MVP 先唔做 partitioning，但 schema ready

CREATE INDEX idx_raw_posts_processing ON raw_posts(processing_status) WHERE processing_status = 'pending';

CREATE INDEX idx_raw_posts_recent ON raw_posts(published_at DESC) WHERE published_at > NOW() - INTERVAL '48 hours';

CREATE INDEX idx_raw_posts_hash ON raw_posts(content_hash);

-- ============================================

-- 2. SCRAPE RUNS — 抓取批次記錄 (NEW)

-- ============================================

CREATE TABLE scrape_runs (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

collector_name TEXT NOT NULL, -- 'youtube_collector', 'lihkg_collector'

collector_version TEXT DEFAULT '1.0',

platform TEXT NOT NULL,

status TEXT NOT NULL, -- 'success'|'partial'|'failed'|'degraded'

status_code INTEGER, -- HTTP status code

posts_fetched INTEGER DEFAULT 0,

posts_new INTEGER DEFAULT 0, -- dedup 後新增幾多

proxy_id TEXT, -- proxy hash (合規追溯)

degradation_level TEXT DEFAULT 'L1', -- 'L1'|'L2'|'L3'

error_message TEXT,

duration_ms INTEGER,

started_at TIMESTAMPTZ DEFAULT NOW(),

completed_at TIMESTAMPTZ

);

CREATE INDEX idx_scrape_runs_recent ON scrape_runs(started_at DESC);

-- ============================================

-- 3. TOPICS (v2)

-- ============================================

CREATE TABLE topics (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

slug TEXT UNIQUE NOT NULL,

canonical_id UUID REFERENCES topics(id), -- 🆕 merge 後指向主 topic

title TEXT NOT NULL,

summary TEXT,

summary_status TEXT DEFAULT 'pending', -- 🆕 'pending'|'generated'|'failed'|'hidden'

-- Heat & Engagement

heat_score INTEGER DEFAULT 0, -- v2.3: INTEGER 0-10000（防 float 排序不穩）

total_engagement BIGINT DEFAULT 0,

source_count INTEGER DEFAULT 0,

post_count INTEGER DEFAULT 0,

-- Sentiment

sentiment_positive FLOAT DEFAULT 0,

sentiment_negative FLOAT DEFAULT 0,

sentiment_neutral FLOAT DEFAULT 0,

sentiment_controversial FLOAT DEFAULT 0,

-- AI Clustering (v2.1 NEW)

centroid vector(1536), -- 🆕 mean(所有 assigned posts 嘅 embeddings)

centroid_post_count INTEGER DEFAULT 0, -- 🆕 用咗幾多 posts 計算 centroid（避免全量重算）

-- Lifecycle

status TEXT DEFAULT 'emerging', -- 🆕 'emerging'|'rising'|'peak'|'declining'|'archive'

first_detected_at TIMESTAMPTZ DEFAULT NOW(),

peak_at TIMESTAMPTZ,

last_updated_at TIMESTAMPTZ DEFAULT NOW(),

-- Safety

flags TEXT[] DEFAULT '{}', -- 🆕 ['suspected_spam', 'sensitive', 'reported']

report_count INTEGER DEFAULT 0, -- 🆕

-- SEO

keywords TEXT[],

meta_description TEXT,

-- Denormalized (fast read)

platforms_json JSONB DEFAULT '{}',

created_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE INDEX idx_topics_heat ON topics(heat_score DESC) WHERE status IN ('emerging','rising','peak');

CREATE INDEX idx_topics_slug ON topics(slug);

CREATE INDEX idx_topics_canonical ON topics(canonical_id);

-- ============================================

-- 4. TOPIC ALIASES — SEO 301 Redirect (NEW)

-- ============================================

CREATE TABLE topic_aliases (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

old_slug TEXT UNIQUE NOT NULL,

topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,

created_at TIMESTAMPTZ DEFAULT NOW()

);

-- ============================================

-- 5. TOPIC POSTS — 正規化 join table (NEW)

-- ============================================

CREATE TABLE topic_posts (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,

post_id UUID REFERENCES raw_posts(id) ON DELETE CASCADE,

similarity_score FLOAT, -- cosine similarity to topic centroid

assigned_method TEXT DEFAULT 'incremental', -- 'incremental'|'recluster'|'manual'

assigned_at TIMESTAMPTZ DEFAULT NOW(),

UNIQUE(topic_id, post_id)

);

CREATE INDEX idx_topic_posts_topic ON topic_posts(topic_id);

-- ============================================

-- 6. TOPIC HISTORY — 熱度時間線

-- ============================================

CREATE TABLE topic_history (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,

heat_score INTEGER, -- v2.3: INTEGER 同 topics table 一致

post_count INTEGER,

engagement BIGINT,

snapshot_at TIMESTAMPTZ DEFAULT NOW()

);

-- ============================================

-- 7. ENTITIES — 同義詞/實體標準化 (NEW)

-- ============================================

CREATE TABLE entities (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

canonical TEXT NOT NULL,

aliases TEXT[] NOT NULL,

category TEXT,

created_at TIMESTAMPTZ DEFAULT NOW()

);

-- ============================================

-- 8. PLATFORM DAILY STATS — Heat Score 正規化 (NEW)

-- ============================================

CREATE TABLE platform_daily_stats (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

platform TEXT NOT NULL,

date DATE NOT NULL,

p50_engagement FLOAT,

p75_engagement FLOAT,

p90_engagement FLOAT,

p95_engagement FLOAT,

p99_engagement FLOAT,

total_posts INTEGER,

UNIQUE(platform, date)

);

-- ============================================

-- 9. CONTENT REPORTS — 用戶舉報 (NEW)

-- ============================================

CREATE TABLE content_reports (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

topic_id UUID REFERENCES topics(id),

post_id UUID REFERENCES raw_posts(id),

reason TEXT NOT NULL,

details TEXT,

reporter_ip TEXT, -- hashed

status TEXT DEFAULT 'pending', -- 'pending'|'reviewed'|'actioned'|'dismissed'

created_at TIMESTAMPTZ DEFAULT NOW()

);

-- ============================================

-- 10. NEWS SOURCES

-- ============================================

CREATE TABLE news_sources (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

name TEXT NOT NULL,

name_en TEXT,

rss_url TEXT NOT NULL,

logo_url TEXT,

language TEXT DEFAULT 'zh-HK',

trust_weight FLOAT DEFAULT 1.0, -- 🆕 用於 heat_score

is_active BOOLEAN DEFAULT TRUE,

priority INTEGER DEFAULT 0

);

-- ============================================

-- 11. AUDIT LOG — Topic 操作記錄 (NEW)

-- ============================================

CREATE TABLE audit_log (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

entity_type TEXT NOT NULL, -- 'topic'|'post'|'report'

entity_id UUID NOT NULL,

action TEXT NOT NULL, -- 'merge'|'split'|'hide'|'restore'|'assign'|'manual_review'

actor TEXT DEFAULT 'system', -- 'system'|'admin'|'auto_report'

details JSONB,

created_at TIMESTAMPTZ DEFAULT NOW()

);

-- ============================================

-- 12. SENSITIVE KEYWORDS — 敏感字過濾 (NEW)

-- ============================================

CREATE TABLE sensitive_keywords (

id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

keyword TEXT NOT NULL,

action TEXT DEFAULT 'block_summary', -- 'block_summary'|'block_topic'|'flag_only'

is_active BOOLEAN DEFAULT TRUE

);

-- ============================================

-- Phase 2: USERS & SUBSCRIPTIONS

-- ============================================

-- (同 v1，略)

-- ============================================

-- RLS Policies

-- ============================================

-- raw_posts, topics, topic_posts: 所有人可讀

-- content_reports: 只寫不讀（防濫用）

-- audit_log: admin only

-- sensitive_keywords: admin only

-----

## 12. API Design (v2)

### 12.1 Internal API (MVP — 唔公開)

> **v2 決策：MVP 階段唔公開 API**（GPT + Gemini 建議），減少 abuse/cache/support 成本。
>
> Public API 延後到 Phase 3。

Internal endpoints (Next.js API Routes):

POST /api/revalidate

- AI Worker 完成聚類後 trigger

- 驗證: QStash signature

- 效果: revalidate homepage + affected topic pages

GET /api/internal/topics

- 供 frontend SSR/ISR 用

- Cached by Redis (60s TTL)

GET /api/internal/topics/[slug]

- 供 topic page SSR/ISR 用

POST /api/report

- 用戶舉報

- Rate limit: 5 req/min per IP

### 12.2 Public API v1（Phase 3 — Cursor-based Pagination）

Base URL: https://hottalk.hk/api/v1

Auth: Bearer token (API key)

Rate Limit:

- Hobby: 1,000 req/day
- Pro: 10,000 req/day
- Business: 100,000 req/day

#### GET /api/v1/trending

// Cursor-based pagination (v2 改進)

// Query: ?limit=20&cursor=eyJ...&platform=all&status=rising,peak

{

"data": [

{

"id": "topic_uuid",

"slug": "mtr-kwun-tong-line-delay",

"title": "港鐵觀塘線嚴重延誤",

"summary": "港鐵觀塘線今朝8點...",

"heat_score": 9832,

"heat_level": 5,

"status": "peak",

"sentiment": {

"positive": 0.08,

"negative": 0.72,

"neutral": 0.15,

"controversial": 0.05

},

"platforms": {

"youtube": {

"count": 3

},

"lihkg": {

"count": 5

},

"news": {

"count": 4,

"outlets": ["hk01", "mingpao"]

},

"google_trends": {

"change": "+340%"

}

},

"first_detected_at": "2026-02-25T08:15:00+08:00",

"url": "https://hottalk.hk/topic/mtr-kwun-tong-line-delay"

}

],

"pagination": {

"next_cursor": "eyJoZWF0X3Njb3JlIjo3NDUxLCJpZCI6Inh4eCJ9",

"has_more": true

},

"meta": {

"generated_at": "2026-02-25T10:00:00+08:00"

}

}

### 12.3 API Pricing (v2 — 加 Hobby Tier)

|Tier |月費 (HKD)|Rate |用途 |
|------------|--------|------------------|---------|
|**Hobby** |$99 |1K req/day |獨立開發者 PoC|
|**Pro** |$399 |10K req/day |中小 Agency|
|**Business**|$1,500+ |100K req/day + SLA|企業客戶 |

-----

## 13. Business Model & Monetization (v2)

### 13.1 Revenue Streams（v2 調整）

Year 1 核心收入（務實版）:

1. Pro 訂閱 (KOL/編輯) — 80% 精力
2. Display Ads (Google AdSense) — 被動收入
3. 數據 API — Phase 3 才上線

Year 2 擴展:

4. Enterprise (品牌監控)
5. Affiliate (旅遊/消費)
6. AI 工具

### 13.2 Pricing Table (v2)

|Tier |月費 (HKD)|功能 |
|--------------|--------|-------------------------------------------|
|**Free** |$0 |熱話牆、各平台 trending、AI 摘要（當日） |
|**Pro** |$99 |+ keyword alert (10個) + 歷史 7 日 + export CSV|
|**Pro Plus** |$299 |+ 無限 alert + 歷史 90 日 + API (1K/day) |
|**Enterprise**|$2,000 |+ 品牌監控 + 競品 + 自動週報 + API (10K/day) |

### 13.3 收入預測 (v2 — 更保守)

|月份 |DAU |Pro|Enterprise|API|廣告 |月收入 (HKD) |
|----|------|---|----------|---|-------|-----------|
|M1-2|50-200|0 |0 |0 |$0 |$0 |
|M3 |500 |3 |0 |0 |$200 |$500 |
|M6 |3,000 |15 |0 |2 |$2,000 |$5,700 |
|M9 |10,000|40 |1 |5 |$5,000 |$14,900 |
|M12 |25,000|80 |3 |10 |$10,000|**$33,700**|

> v2 vs v1：M12 收入從 $60,200 降至 $33,700（更保守但更可信）

> Enterprise 前 6 個月預計 0 — Solo dev 無時間做 B2B sales

-----

## 14. Go-to-Market Strategy

### 14.1 Phase 1: SEO + Organic (Month 1-4)

Programmatic SEO（唯一增長引擎 — MVP 階段）

自動生成：

/topic/[slug] — 每個熱話事件

/trending/[date] — 每日熱話存檔

SEO 要素：

<title>{topic.title} | 全平台熱議懶人包 | HotTalk HK</title>

<meta name="description" content="{topic.summary}">

<meta property="og:image" content="/api/og?topic={slug}"> (auto-generated)

<link rel="canonical" href="https://hottalk.hk/topic/{slug}">

JSON-LD structured data (Article + BreadcrumbList)

sitemap.xml (auto-generated, daily update)

robots.txt:

User-agent: *

Allow: /

Allow: /topic/

Allow: /trending/

Disallow: /admin/

Disallow: /api/

Disallow: /search

User-agent: GPTBot

Disallow: /

User-agent: CCBot

Disallow: /

### 14.2 Phase 2: Social + Community (Month 4-6)

- Telegram Bot 每日推送
- IG/Threads 每日「十大熱話」圖
- KOL seeding（50 個免費 Pro 帳號）

### 14.3 Phase 3: B2B (Month 6-12)

- Agency partnership
- TVP 科技券申請

-----

## 15. Legal & Compliance (v2)

### 15.1 香港私隱條例對策

✅ 平台定位：「公共話題聚合」非「人物搜索」

✅ PII 過濾 Pipeline:

- Regex: 電話 (\d{4}[\s-]?\d{4})
- Regex: 身分證 ([A-Z]\d{6}\(\d\))
- Regex: 住址（含「室」「座」「樓」嘅完整地址 pattern）
- 人名: 暫不過濾（公開平台用戶名）但唔做 cross-platform 身份關聯

✅ 內容舉報 + 下架機制（F9）

### 15.2 版權 Fair Dealing

✅ 新聞只展示：標題 + AI 生成 50 字摘要 + 導向原文連結

✅ AI 摘要 prompt 明確要求「唔好直接抄原文」

✅ 標明來源（充分確認聲明）

✅ 利好：HK 政府推進 TDM 版權豁免（商業+非商業）

✅ 投訴處理：收到版權投訴 → 24h 內移除 AI 摘要，保留標題+連結

### 15.3 敏感字過濾（NEW）

✅ sensitive_keywords table 維護黑名單

✅ raw_post 標題包含敏感字 → 禁止 AI 生成 topic summary

✅ 可配置 action: 'block_summary' | 'block_topic' | 'flag_only'

✅ 初始名單由 admin 手動維護

### 15.4 AI Cost Protection（NEW）

✅ OpenAI embedding: daily spending alert at $1 → hard stop at $5

✅ Claude summarization: daily token cap 500K → hard stop

✅ 超限 → graceful degradation（保留標題，無摘要）

✅ 監控 dashboard: daily token usage + cost chart

-----

## 16. Development Sprint Plan (v2 — 6 Weeks)

> v2 核心變更：4 週 → 6 週，砍走所有增長工具，加 AI 調參 buffer

### Sprint 0: Setup (Day 1-2)

□ 購買域名 hottalk.hk

□ Next.js 14 (App Router) + Tailwind + shadcn/ui init

□ Supabase project setup (PostgreSQL + pgvector + Auth)

□ Upstash Redis + QStash setup

□ Railway project setup (Python 3.11 FastAPI)

□ Vercel deployment

□ Database schema v2 (all tables)

□ Environment variables + secrets

□ Git repo + CI/CD

### Sprint 1: Data Collection (Week 1)

Day 1-2: YouTube Collector

□ YouTube Data API v3 integration (Edge Function)

□ QStash schedule: every 15 min

□ Store to raw_posts + scrape_runs

□ Dedup by platform_id

Day 3-4: News RSS Collector

□ RSS parser (Edge Function)

□ 自架 RSSHub on Railway

□ 10+ 港媒 RSS sources config

□ canonical_url + content_hash dedup

□ QStash schedule: every 5 min

Day 5: Google Trends Collector

□ pytrends integration (Railway Python)

□ SerpApi fallback config

□ QStash schedule: every 30 min

Day 6-7: LIHKG Collector (with 3-tier degradation)

□ 非官方 API integration (Edge Function)

□ Rotating proxy setup

□ L1/L2/L3 degradation logic

□ Exponential backoff on 403/429

□ scrape_runs logging

□ QStash schedule: every 10 min

### Sprint 2: AI Pipeline (Week 2)

Day 1-2: Embedding + Entity Normalization

□ entities table seed data (50+ 常用 HK entities)

□ normalize_text() function

□ OpenAI embedding integration (Railway)

□ Batch embed new raw_posts

Day 3-4: Incremental Topic Assignment

□ cosine similarity search (near 24h topic centroids)

□ Threshold tuning (start with 0.80)

□ New topic creation logic (≥3 posts, ≥2 platforms)

□ topic_posts join table writes

□ heat_score v2 calculation

Day 5: AI Summarization

□ Claude Haiku integration

□ Prompt engineering (JSON output)

□ Validation + retry logic

□ Sensitive keyword filter

□ Daily token cap enforcement

Day 6: Nightly Recluster (HDBSCAN)

□ Full batch HDBSCAN on 48h data

□ Topic reconciliation (merge/split)

□ topic_aliases + canonical_id update

□ Quality metrics generation

Day 7: Integration Test

□ Full pipeline dry run

□ Verify topic stability

□ Verify heat_score ranking makes sense

□ Check LLM output quality

### Sprint 3: Frontend Core (Week 3)

Day 1-2: Trending Wall (Homepage)

□ ISR homepage (revalidate=300)

□ On-demand revalidation webhook

□ Topic cards: title, heat, platforms, summary (2 lines)

□ Platform tabs

□ Mobile responsive

□ 「更新於 X 分鐘前」timestamp

Day 3-4: Topic Detail Page

□ /topic/[slug] ISR page

□ Full summary + sentiment chart

□ Related posts by platform

□ OG meta tags + JSON-LD

□ canonical URL + 301 from aliases

Day 5: Platform Pages

□ /platform/youtube

□ /platform/lihkg

□ /platform/news

□ /platform/google-trends

Day 6-7: SEO + Polish

□ sitemap.xml auto-generation

□ robots.txt (block AI crawlers)

□ OG image auto-generation (/api/og)

□ Loading states + error pages

□ 「⚠️ 報告」功能

### Sprint 4: Admin + Stability (Week 4)

Day 1-2: Admin Topic Review

□ /admin/topic-review page

□ Merge/split/hide/restore 功能

□ Audit log

□ Daily sampling (50 topics)

□ Quality metrics dashboard

Day 3-4: AI Pipeline Tuning

□ 根據 admin review 數據調整:

- cosine threshold
- HDBSCAN parameters
- entity normalization rules

□ Eval pairs table + benchmark

Day 5-7: Stability + Monitoring

□ Collector 穩定性驗證 (72h 連續運行)

□ Redis error counters setup

□ QStash → Telegram alert webhook

□ /admin/status dashboard (collector health + LLM cost)

□ AbortController timeout 驗證 (Edge Functions)

□ Graceful degradation 驗證

□ Performance: Lighthouse > 90

### Sprint 5: Pre-launch Polish (Week 5)

Day 1-2: Content & Legal

□ Privacy Policy page

□ Terms of Service page

□ About page

□ Report guidelines page

Day 3: 冷啟動內容填充 (v2.2 NEW)

□ Launch 前 7 日開始跑所有 collectors

□ 累積真實 topic 數據（確保首頁 > 10 topics）

□ 若 topic 數量不足 → 人手 seed 20-30 個熱話

- 用近 48h YouTube Trending + News RSS 嘅真實數據
- 手動觸發 AI summarization
- 確保 heat_score 分佈自然
- ⚠️ v2.3: seed topics 標記 data_quality='seed'
- platform_daily_stats 排除 seed: WHERE data_quality != 'seed'

□ 建立 topic_history 初始數據（趨勢圖唔會空白）

□ 驗證首頁永遠 ≥ 10 topics 嘅 fallback 邏輯:

IF active_topics < 10: 放寬條件：source_diversity ≥ 1（唔需要跨平台）

Day 4-5: 全面測試

□ Mobile testing (iOS Safari + Android Chrome)

□ Edge case testing (0 topics, single platform, LIHKG down)

□ SEO audit (canonical, sitemap, structured data)

□ 跨瀏覽器測試

Day 5-7: Soft Launch

□ 邀請 10-20 個 beta 用戶（朋友/KOL）

□ 收集 feedback

□ Bug fixes

□ AI quality 最後一輪人手 review

### Sprint 6: Launch (Week 6)

Day 1-3: 修復 beta feedback

Day 4: 🚀 PUBLIC LAUNCH

□ LIHKG 發帖介紹

□ Telegram channels 宣傳

□ 個人社交媒體宣傳

□ Google Search Console submit sitemap

Day 5-7: Monitor + Hotfix

□ 監控 DAU / bounce rate / errors

□ 快速修復 critical bugs

□ 開始記錄 Phase 2 需求

-----

## 17. KPIs & Success Metrics

### 17.1 North Star: DAU

### 17.2 KPI (v2 — 更保守)

|指標 |M1 |M3 |M6 |M12 |
|-----------------|---|-------|------|-------|
|DAU |50 |500 |3,000 |25,000 |
|MAU |200|2,500 |15,000|120,000|
|Avg Session |30s|1.5 min|2 min |3 min |
|Pages/Session |1.2|2.0 |2.5 |3.0 |
|SEO Indexed Pages|50 |1,000 |5,000 |30,000 |
|Organic % |0% |15% |35% |50% |
|Pro Subs |0 |3 |15 |80 |
|Revenue (HKD) |$0 |$500 |$5,700|$33,700|

### 17.3 AI Pipeline Quality

|指標 |目標 |量度方法 |
|--------------------------|-------|----------------------------------------|
|Topic clustering precision|>80% |Admin review 每日抽樣 50 |
|AI summary relevance |>85% |1-5 分人手評分 |
|False topic merge rate |<5% |Audit log 分析 |
|Topic detection latency |<15 min|first_detected_at vs source published_at|
|LLM daily cost |<$0.10 |Cost monitoring dashboard |

-----

## 18. Risk Register (v2)

|# |風險 |概率|影響|緩解措施 |
|---|------------------------|--|--|--------------------------------------------------------|
|R1 |LIHKG 封鎖爬蟲 |高 |中 |3 層降級 + 雙 proxy vendor + L3 最低模式 |
|R2 |Topic 聚類質量差 |中 |高 |增量 assign + 夜間重聚類 + admin review + eval framework |
|R3 |LLM 成本失控 |低 |高 |Daily token hard cap + cost alert + graceful degradation|
|R4 |SEO slug 漂移 |中 |高 |不含日期 slug + topic_aliases + canonical_id + 301 redirect |
|R5 |版權投訴 |低 |中 |只用標題+AI摘要 + 導向原文 + 24h 投訴移除流程 |
|R6 |私隱條例違規 |低 |極高|PII 自動過濾 + 敏感字黑名單 + 舉報機制 |
|R7 |AI hallucination 公審 |中 |高 |報告按鈕 + 自動隱藏 + admin review |
|R8 |Railway Python worker 不穩|低 |中 |Health check + auto-restart + graceful degradation |
|R9 |跨語言聚類失敗 |中 |中 |Entity normalization + 加長 embedding context |
|R10|競品抄襲 |中 |中 |快速迭代 + AI 廣東話模型深化 + 社群建立 |
|R11|假熱話/水軍 |中 |中 |跨平台驗證 (≥2 sources) + velocity 異常偵測 + spam flag |
|R12|敏感政治內容 |中 |高 |敏感字過濾 + block_summary action + admin 人手 review |

-----

## 19. Resolved Questions (from v1 Review)

> 以下 15 條 Open Questions 已由 GPT + Gemini Review 解答，v2 已整合所有答案。

|# |問題 |結論 |已整合到 |
|---|------------------------|---------------------------------------|----------|
|Q1 |HDBSCAN 在 Edge Function?|❌ 跑唔到。改用 Railway Python Worker |Section 10|
|Q2 |pgvector scalability |只查 24-48h 窗口，MVP 先唔做 partitioning |Section 11|
|Q3 |ISR vs On-demand |兩者兼用：ISR=300 + pipeline 完成後 on-demand |Section 10|
|Q4 |Embedding model |堅守 text-embedding-3-small，但建議做離線 eval |Section 9 |
|Q5 |首頁優先級 |AI 聚合話題優先，平台 tab 作次級入口 |Section 7 |
|Q6 |熱度展示 |分級🔥 + 小字數字 (9,832 ↗) |Section 5 |
|Q7 |匿名 vs 登入 |Free 全部免登入，登入只為 Pro |Section 5 |
|Q8 |MVP 做 TG Bot? |❌ 延後到 Phase 2 |Section 6 |
|Q9 |Affiliate 可行性 |可行但轉化低，唔做核心收入 |Section 13|
|Q10|API pricing |加 Hobby $99/月 tier |Section 12|
|Q11|LIHKG 法律風險 |主要係 IP Ban 非刑事；metadata only + 投訴流程 |Section 15|
|Q12|AI 摘要 derivative work? |Transformative use；prompt 要求唔抄原文 |Section 15|
|Q13|廣東話混合 embedding |title + desc + entity normalized 增加語義交集|Section 9 |
|Q14|Google Trends 延遲 |12-24h 延遲；改為加權信號非觸發條件 |Section 8 |
|Q15|假熱話處理 |跨平台驗證 + velocity 異常 + spam flag 三層防護 |Section 9 |

-----

## 20. Appendix

### 20.1 v1 → v2 → v2.1 → v2.2 → v2.3 變更日誌

v2.3 變更（GPT 數學精度修正）：

|變更 |Section |
|---------------------------------------------|----------|
|raw_engagement 口徑鎖死（4 平台唯一定義） |9.6 |
|heat_score 改 INTEGER (topics + topic_history)|9.6, 11 |
|跨時間事件保護（72h+7d 強制新建 topic） |9 Pipeline|
|velocity 改 min(1, posts_1h/3)（防小樣本假高） |9.6 |
|seed data_quality='seed' + 排除 percentile 污染 |9.6, 16 |
|Nightly recluster SEO 閘（>48h 禁 split） |9 Pipeline|
|平台缺失時權重 re-normalize |9.6 |
|keywords fallback 詞頻 top 3 |9.5 |
|48h 查詢硬限制（所有 vector query 強制加） |9 Safety |
|raw_posts 加 view_count_delta_24h |11 |
|新增《Heat Score 數學定義 v1.0》獨立文件 |附件 |

v2.2 變更（GPT 最終壓力測試）：

|變更 |Section|
|-----------------------------------------------------------|-------|
|Incremental assign 加 top 300 active topics 上限 |9 |
|Centroid 每 20 posts full recompute（防數值漂移） |9 |
|Heat score Day 8-10 平滑過渡公式 |9 |
|LIHKG 替代來源（YT comments/FB/Dcard）加入 Phase 1.5 |6 |
|冷啟動 seed 策略 + 首頁 ≥10 topics fallback |16 |
|Topic status 自動轉換規則（emerging→rising→peak→declining→archive）|9 |
|content_hash 改用 SHA(normalized_title)（轉載去重） |11 |
|Admin review 改 top 20 + flagged（唔再固定 50） |5 |

v2.1 變更（Claude Self-Review）:

|變更 |Section|
|--------------------------------------------------------|-------|
|Topics table 新增 centroid + centroid_post_count columns |9, 11 |
|Centroid 增量更新公式: new = (old×n + new) / (n+1) |9 |
|Railway always-on mode (~$5/月) + QStash retry 30/60/120s|10 |
|Embedding batch 優化（一次 batch call 取代逐個） |9 |
|Heat score bootstrap: Day 1-7 用 simple rank |9 |
|Edge Function AbortController timeout 120s |8 |
|Monitoring: Redis error counters + QStash → TG webhook |9 |
|/admin/status dashboard (collector health + LLM cost) |16 |

v2.0 變更（GPT + Gemini Review）:

|變更 |來源 |Section |
|-------------------------------------|--------------------|--------|
|AI Pipeline 改 Railway Python Worker |GPT 🔴 + Gemini 🔴 |9, 10 |
|增量 assign + 夜間重聚類 |GPT 🔴 |9 |
|4 週 → 6 週 Sprint |GPT 🔴 + Gemini 🔴 |16 |
|Heat score per-platform normalization|GPT 🔴 |9 |
|LIHKG 3 層降級 |GPT 🔴 + Gemini 🔴 |8 |
|Topic 穩定性 (canonical_id, aliases) |GPT 🔴 |11 |
|scrape_runs table |GPT 🟡 |11 |
|topic_posts join table |GPT 🟡 |11 |
|content_hash + canonical_url |GPT 🟡 |11 |
|entities table (同義詞) |GPT 🟡 |9, 11 |
|報告/下架機制 |Gemini 🟡 |5 |
|Admin topic review |GPT 🟡 |5 |
|Cursor-based pagination |GPT 🟡 + Gemini 🟡 |12 |
|API Hobby tier |GPT Q10 + Gemini Q10|12 |
|Threads 改 keyword_search |GPT 🟡 |8 |
|Topic slug 唔用日期 |GPT Minor |7 |
|Block GPTBot |Gemini Minor |14 |
|敏感字過濾 |Gemini 🟡 |15 |
|LLM cost hard cap |GPT 🟡 + Gemini 🟡 |9 |
|Graceful degradation |GPT 🟡 |9 |
|QStash 替代 pg_cron |Gemini Minor |10 |
|收入預測更保守 |GPT/Gemini 共識 |13 |
|MVP 砍走 Bot/API/Search/Threads |GPT 🔴 + Gemini 🔴 |5, 6, 16|

### 20.2 Session Handoff 文件

HOTTALK-SESSION-HANDOFF-2026-02-25.md

狀態: Spec v2.3 FINAL（5 輪 AI Review 全部完成）

Review 狀態: 5/5（GPT ✅✅✅ Gemini ✅ Claude ✅）

附件: HOTTALK-HEAT-SCORE-MATH-v1.0.md（數學定義獨立文件）

下一步: Sprint 0 (Setup)

-----

> 文件結束 — HotTalk HK Product Specification v2.3 (FINAL)
>
> 5 輪 AI Review 完成：GPT ✅✅✅ Gemini ✅ Claude ✅
>
> 整合: 10 Critical + 8 Major + 15 Q&A + 6 Self-Review + 8 Pressure Test + 10 Math Precision
>
> 附件: HOTTALK-HEAT-SCORE-MATH-v1.0.md
>
> 準備開始 Sprint 0。

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

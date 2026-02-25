# CLAUDE.md — HotTalk HK 開發指引

## 項目簡介

HotTalk HK 係香港版「今日熱榜」— 免費跨平台社交媒體熱點聚合平台。

用 AI 將 YouTube、LIHKG、新聞、Google Trends 嘅熱話自動歸類，一頁睇晒全港熱話。

完整規格書： HOTTALK-HK-PRODUCT-SPEC-v2.3.md

Heat Score 數學定義： HOTTALK-HEAT-SCORE-MATH-v1.0.md

Session Handoff： HOTTALK-SESSION-HANDOFF-2026-02-25.md

## 技術棧

Frontend: Next.js 14 (App Router, ISR + On-demand) + Tailwind CSS + shadcn/ui

Database: Supabase (PostgreSQL + pgvector + Edge Functions + Auth)

Cache: Upstash Redis + QStash (scheduler/webhook)

AI Worker: Zeabur (Python 3.11 FastAPI, always-on)

AI APIs: Claude Haiku (summarization) + OpenAI text-embedding-3-small (vectors)

Hosting: Vercel (frontend) + Supabase Cloud + Zeabur + Upstash

## Project Structure

hottalk-hk/

├── src/

│ ├── app/

│ │ ├── page.tsx # 首頁 — 全港熱話牆

│ │ ├── layout.tsx # Root layout

│ │ ├── topic/[slug]/page.tsx # 話題詳情頁 (Programmatic SEO)

│ │ ├── platform/

│ │ │ ├── youtube/page.tsx

│ │ │ ├── lihkg/page.tsx

│ │ │ ├── news/page.tsx

│ │ │ └── google-trends/page.tsx

│ │ ├── admin/

│ │ │ └── topic-review/page.tsx # Admin QA (需 auth)

│ │ └── api/

│ │ ├── revalidate/route.ts # AI Worker trigger ISR revalidation

│ │ └── report/route.ts # 用戶舉報 endpoint

│ ├── lib/

│ │ ├── supabase.ts # Supabase client (server + browser)

│ │ ├── redis.ts # Upstash Redis client

│ │ └── types.ts # TypeScript types (對應 DB schema)

│ └── components/ # Reusable UI components

├── supabase/

│ └── migrations/

│ └── 0000_init_schema.sql # v2.3 DB schema (12 tables)

├── worker/ # Python AI Worker (deploy to Zeabur)

│ ├── main.py # FastAPI app

│ ├── jobs/

│ │ ├── incremental_assign.py # 每 10 min 增量聚類

│ │ ├── nightly_recluster.py # 每日 02:00 HDBSCAN

│ │ └── summarize.py # Claude Haiku 摘要生成

│ ├── collectors/ # 數據抓取（如果唔用 Edge Functions）

│ ├── utils/

│ │ ├── embedding.py # OpenAI embedding (batch)

│ │ ├── entity_normalize.py # 同義詞標準化 (港鐵→MTR)

│ │ ├── heat_score.py # Heat Score 計算 (見 Math 文件)

│ │ └── sensitive_filter.py # 敏感字過濾

│ ├── requirements.txt

│ └── Dockerfile

├── CLAUDE.md # 本文件

├── HOTTALK-HK-PRODUCT-SPEC-v2.3.md

├── HOTTALK-HEAT-SCORE-MATH-v1.0.md

├── HOTTALK-SESSION-HANDOFF-2026-02-25.md

├── .env.local.example

└── package.json

## Coding Conventions

### TypeScript (Frontend)

- 用 TypeScript strict mode
- 組件用 functional component + hooks
- 用 shadcn/ui 組件庫，唔好自己寫 UI primitives
- API 用 Next.js Route Handlers (app/api/)
- 數據 fetching 用 Server Components + ISR
- 唔使 use client 除非真係需要 interactivity

### Python (AI Worker)

- Python 3.11+, type hints everywhere
- FastAPI + Pydantic models
- Async/await for DB + API calls
- 所有 secrets 用 environment variables
- Logging 用 structlog (JSON format)

### 共通

- Commit message 格式: Sprint X: 簡短描述
- 唔好用 any/unknown type，全部都要有 type
- 所有 magic numbers 抽成 constants
- Error handling: 永遠 try-catch 外部 API calls

## 關鍵技術決策（唔好改）

### 1. Heat Score 係 INTEGER (0-10000)

- 唔係 float。見 HOTTALK-HEAT-SCORE-MATH-v1.0.md
- topics.heat_score 同 topic_history.heat_score 都係 INTEGER

### 2. 所有 vector query 強制 48h WHERE

WHERE published_at > NOW() - INTERVAL '48 hours'

無例外。唔加就係 bug。

### 3. Incremental Assign 只比較 top 300 active topics

WHERE status IN ('emerging','rising','peak')
AND last_updated_at > NOW() - INTERVAL '24 hours'
ORDER BY heat_score DESC
LIMIT 300

### 4. Centroid 每 20 posts full recompute

if topic.centroid_post_count % 20 == 0:
centroid = mean(ALL topic_posts embeddings)

### 5. Velocity 定義

velocity = min(1.0, posts_in_last_1h / 3.0)

### 6. 跨時間事件保護

if hours_since(topic.last_updated_at) > 72 and days_since(topic.first_detected_at) > 7:
強制新建 topic（唔 merge 到舊嘅）

### 7. Topic > 48h 禁止 split

Nightly recluster 時，topic_age > 48h 只允許 merge + 301 alias，唔準 split。

### 8.content_hash 用 normalized title

content_hash = sha256(normalize(title)) # lowercase + strip punctuation + trim

### 9. Embedding 用 batch call

每 10 分鐘累積所有 pending posts → 一次 batch embed → 唔好逐個 call。

### 10. Seed data 唔污染 percentile

WHERE data_quality != 'seed'

## Sprint Plan 概覽

Sprint 0: Setup (Done) — repo, Vercel, Supabase, Zeabur

Sprint 1: Data Collection — YouTube, News RSS, Google Trends, LIHKG collectors

Sprint 2: AI Pipeline — Embedding, clustering, summarization, heat score

Sprint 3: Frontend Core — Trending wall, topic page, platform tabs

Sprint 4: Admin + Stability — Admin review, monitoring, alerting

Sprint 5: Pre-launch — Legal pages, testing, cold start seed, QA

Sprint 6: Launch — Public launch + monitor

## Database Schema

完整 schema 見 `supabase/migrations/0000_init_schema.sql`（12 個 tables）。

核心 tables:

- raw_posts — 各平台抓取數據 + embedding vector
- topics — AI 聚類話題 + heat_score + centroid
- topic_posts — topic-post join table
- scrape_runs — 抓取批次記錄
- entities — 同義詞標準化
- platform_daily_stats — heat score percentile 用
- content_reports — 用戶舉報
- audit_log — 操作記錄

## 當你開始一個新 task

1. 先讀相關嘅 spec section
1. 寫 code 前確認你理解 data flow
1. 每個 feature 做完 commit 一次
1. 外部 API call 永遠有 error handling + timeout
1. 唔確定嘅嘢問我，唔好自己 assume

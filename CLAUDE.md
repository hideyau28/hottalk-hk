# CLAUDE.md — HotTalk HK 開發指引

## 項目簡介

HotTalk HK 係香港版「今日熱榜」— 免費跨平台社交媒體熱點聚合平台。
用 AI 將 YouTube、LIHKG、新聞、Google Trends 嘅熱話自動歸類，一頁睇晒全港熱話。

**完整規格書：** `HOTTALK-HK-PRODUCT-SPEC-v3.2.md`
**Heat Score 數學定義：** `HOTTALK-HEAT-SCORE-MATH-v1.0.md`（Phase 2 參考，Launch 用簡化版）
**Session Handoff：** `HOTTALK-SESSION-HANDOFF-2026-02-25.md`

## 技術棧

```
Frontend:  Next.js 14 (App Router, ISR + On-demand) + Tailwind CSS + shadcn/ui
Database:  Supabase (PostgreSQL + pgvector + Edge Functions + Auth)
Cache:     Upstash Redis + QStash (scheduler/webhook)
AI Worker: Zeabur (Python 3.11 FastAPI, always-on)
AI APIs:   Claude Haiku (summarization) + OpenAI text-embedding-3-small (vectors)
Hosting:   Vercel (frontend) + Supabase Cloud + Zeabur + Upstash
```

## Project Structure

```
hottalk-hk/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 首頁 — 全港熱話牆
│   │   ├── layout.tsx                  # Root layout
│   │   ├── topic/[slug]/page.tsx       # 話題詳情頁 (Programmatic SEO)
│   │   ├── platform/
│   │   │   ├── youtube/page.tsx
│   │   │   ├── lihkg/page.tsx
│   │   │   ├── news/page.tsx
│   │   │   └── google-trends/page.tsx
│   │   ├── admin/
│   │   │   └── topic-review/page.tsx   # Admin QA (需 auth)
│   │   └── api/
│   │       ├── revalidate/route.ts     # AI Worker trigger ISR revalidation
│   │       └── report/route.ts         # 用戶舉報 endpoint
│   ├── lib/
│   │   ├── supabase.ts                 # Supabase client (server + browser)
│   │   ├── redis.ts                    # Upstash Redis client
│   │   └── types.ts                    # TypeScript types (對應 DB schema)
│   └── components/                     # Reusable UI components
├── supabase/
│   └── migrations/
│       └── 0000_init_schema.sql        # DB schema (12 tables)
├── worker/                             # Python AI Worker (deploy to Zeabur)
│   ├── main.py                         # FastAPI app
│   ├── jobs/
│   │   ├── incremental_assign.py       # 每 10 min 增量聚類（production 唯一寫入路徑）
│   │   ├── nightly_recluster.py        # v3.2: offline analysis only，唔寫 production
│   │   └── summarize.py                # Claude Haiku 摘要生成
│   ├── collectors/
│   ├── utils/
│   │   ├── embedding.py                # OpenAI embedding (batch)
│   │   ├── heat_score.py               # v3.2: 簡化加權公式
│   │   └── sensitive_filter.py         # 敏感字過濾
│   ├── requirements.txt
│   └── Dockerfile
├── CLAUDE.md                           # 本文件
├── HOTTALK-HK-PRODUCT-SPEC-v3.2.md
├── HOTTALK-HEAT-SCORE-MATH-v1.0.md
├── HOTTALK-SESSION-HANDOFF-2026-02-25.md
├── .env.local.example
└── package.json
```

## Coding Conventions

### TypeScript (Frontend)
- 用 TypeScript strict mode
- 組件用 functional component + hooks
- 用 shadcn/ui 組件庫，唔好自己寫 UI primitives
- API 用 Next.js Route Handlers (app/api/)
- 數據 fetching 用 Server Components + ISR
- 唔使 `use client` 除非真係需要 interactivity

### Python (AI Worker)
- Python 3.11+, type hints everywhere
- FastAPI + Pydantic models
- Async/await for DB + API calls
- 所有 secrets 用 environment variables
- Logging 用 structlog (JSON format)

### 共通
- Commit message 格式: `Sprint X: 簡短描述`
- 唔好用 any/unknown type，全部都要有 type
- 所有 magic numbers 抽成 constants
- Error handling: 永遠 try-catch 外部 API calls

## v3.2 Launch Cut 關鍵決策（唔好改）

### 1. Heat Score 係 INTEGER (0-10000) — 簡化加權版
```python
# v3.2: 簡單加權，唔做 percentile，唔做 bootstrap
engagement = mean(log_scaled_per_platform)  # log1p(raw) / 10
heat_score = int((
    0.50 * engagement +
    0.20 * diversity +      # min(platforms / 3, 1.0)
    0.20 * recency +        # exp(-0.05 * hours)
    0.10 * trends_signal
) * 10000)
```
唔做 percentile。唔做 bootstrap blend。唔做 platform missing reweight。

### 2. 所有 vector query 強制 48h WHERE
```sql
WHERE published_at > NOW() - INTERVAL '48 hours'
```
無例外。唔加就係 bug。

### 3. Incremental Assign 只比較 top 300 active topics
```sql
WHERE status IN ('active','declining')
  AND last_updated_at > NOW() - INTERVAL '24 hours'
ORDER BY heat_score DESC LIMIT 300
```

### 4. Centroid 每 20 posts full recompute
```python
if topic.centroid_post_count % 20 == 0:
    centroid = mean(ALL topic_posts embeddings)
```

### 5. HDBSCAN = Offline Analysis Only
```
❌ 唔准自動 merge/split production topics
❌ 唔准自動更新 topic_aliases / canonical_id
✅ 只生成 admin suggestions（「Topic A 同 B 可能應該 merge」）
✅ Admin 人手決定 merge
```

### 6. 跨時間事件保護
```python
if hours_since(topic.last_updated_at) > 72 and days_since(topic.first_detected_at) > 7:
    強制新建 topic（唔 merge 到舊嘅）
```

### 7. content_hash 用 normalized title
```python
content_hash = sha256(normalize(title))  # lowercase + strip punctuation + trim
```

### 8. Embedding 用 batch call
每 10 分鐘累積所有 pending posts → 一次 batch embed → 唔好逐個 call。

### 9. 付費牆 = Feature-based（唔係 Metered）
```
Free: 全部內容可睇（附廣告）+ Daily Brief Top 5 標題（12:00）
Pro:  完整 Brief Top 10 + AI 摘要（08:00）+ Telegram + 無廣告 + 歷史
唔做「20 個/月」metered tracking — 追蹤唔到匿名用戶
```

### 10. Daily Brief M1 即上線
```
M1-3: 免費公開版（網頁，12:00，Top 5 標題）
M4+:  Pro 升級版（08:00，Top 10 + AI 摘要 + Telegram + Email）
```

## 明確唔做清單（Launch Cut）

| 功能 | 觸發升級條件 |
|---|---|
| HDBSCAN auto merge/split | Admin manual merge > 10/日 |
| Entity normalization table | Clustering precision < 70% |
| Percentile heat score | 排名明顯唔合理 > 20% |
| Threads collector | Meta API 審批通過 |
| 關鍵字即時預警 | Pro 用戶 > 200 |
| Public API | B2B 客戶 > 5 |
| B2B real-time dashboard | B2B report 客戶 > 3 |

## Database Schema

完整 schema 見 `supabase/migrations/0000_init_schema.sql`（12 個 tables）。
核心 tables:
- `raw_posts` — 各平台抓取數據 + embedding vector
- `topics` — AI 聚類話題 + heat_score + centroid
- `topic_posts` — topic-post join table
- `scrape_runs` — 抓取批次記錄
- `platform_daily_stats` — Phase 2 用（heat score percentile）
- `content_reports` — 用戶舉報
- `audit_log` — 操作記錄

## 當你開始一個新 task

1. 先讀 CLAUDE.md（本文件）
2. 如果涉及 AI pipeline → 讀 docs/AI-PIPELINE.md
3. 如果涉及 DB → 讀 docs/DATA-MODEL.md
4. 唔好讀完整 spec（太大會超 token limit）
5. 寫 code 前確認你理解 data flow
6. 每個 feature 做完 commit 一次
7. 外部 API call 永遠有 error handling + timeout
8. 唔確定嘅嘢問我，唔好自己 assume

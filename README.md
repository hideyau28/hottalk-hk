# HotTalk HK

香港版「今日熱榜」— 免費跨平台社交媒體熱點聚合平台。
AI 自動將 YouTube、LIHKG、新聞、Google Trends 嘅熱話歸類，一頁睇晒全港熱話。

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router, ISR) + Tailwind + shadcn/ui |
| Database | Supabase (PostgreSQL + pgvector) |
| Cache | Upstash Redis + QStash (scheduler) |
| AI Worker | Zeabur (Python FastAPI) |
| AI APIs | Google Gemini Flash + text-embedding-004 |
| Hosting | Vercel + Supabase Cloud + Zeabur + Upstash |

## Local Dev

```bash
npm install
cp .env.local.example .env.local  # fill in values
npm run dev
```

## Architecture

```
QStash Cron (every 10 min)
    ├→ Supabase Edge Functions: youtube / lihkg / news collectors
    ├→ Zeabur Worker: google-trends collector
    └→ Zeabur Worker: incremental-assign (cluster + heat score)
         └→ Vercel: ISR revalidation → fresh homepage
```

---

## Deployment Checklist

### Prerequisites

- [ ] Supabase account (free tier OK)
- [ ] Vercel account (free tier OK)
- [ ] Zeabur account (for Python worker)
- [ ] Upstash account (Redis + QStash)
- [ ] Google Cloud Console project (YouTube API + Gemini API)
- [ ] Telegram Bot (for alerting, optional)

### Step 1: Supabase Project

1. Create project at https://supabase.com/dashboard — Region: Singapore
2. Enable pgvector: Dashboard → Database → Extensions → "vector" → Enable
3. Run migrations in SQL Editor (in order):
   - `supabase/migrations/0000_init_schema.sql` (12 tables + indexes)
   - `supabase/migrations/0001_daily_briefs.sql`
   - `supabase/migrations/0002_vector_768.sql`
   - `supabase/migrations/0003_seed_news_sources.sql` (12 HK news RSS sources)
4. Verify: Table Editor → 13 tables, `news_sources` has 12 rows

Collect: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from Settings → API

### Step 2: Supabase Auth

1. Authentication → Providers → Email → Enable
2. Users → Add User → your admin email + password
3. This email must match `ADMIN_EMAILS` env var

### Step 3: Google API Keys

| Key | Where |
|-----|-------|
| `YOUTUBE_API_KEY` | Google Cloud Console → YouTube Data API v3 → Credentials |
| `GOOGLE_AI_API_KEY` | https://aistudio.google.com/apikey |

### Step 4: Upstash Redis + QStash

| Service | Config |
|---------|--------|
| Redis | console.upstash.com → Create Database → Region: Singapore |
| QStash | console.upstash.com → QStash tab → Signing Keys |

Collect: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`

### Step 5: Deploy Supabase Edge Functions

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

supabase secrets set \
  YOUTUBE_API_KEY=<key> \
  UPSTASH_REDIS_REST_URL=<url> \
  UPSTASH_REDIS_REST_TOKEN=<token> \
  QSTASH_CURRENT_SIGNING_KEY=<key> \
  QSTASH_NEXT_SIGNING_KEY=<key>

supabase functions deploy youtube-collector
supabase functions deploy lihkg-collector
supabase functions deploy news-collector
```

### Step 6: Deploy Worker to Zeabur

1. zeabur.com → New Project → Deploy from Git → Root: `worker/`
2. Set env vars (see table below)
3. Verify: `curl https://<worker>.zeabur.app/health` → `{"status":"ok","db":"connected"}`

### Step 7: Deploy Frontend to Vercel

1. vercel.com → Add New Project → Import Git Repo
2. Set env vars (see table below)
3. Verify: visit `https://<app>.vercel.app`

### Step 8: QStash Cron Schedules

console.upstash.com → QStash → Schedules → Create:

| Job | Endpoint | Cron |
|-----|----------|------|
| YouTube | `https://<project>.supabase.co/functions/v1/youtube-collector` | `*/10 * * * *` |
| LIHKG | `https://<project>.supabase.co/functions/v1/lihkg-collector` | `*/10 * * * *` |
| News | `https://<project>.supabase.co/functions/v1/news-collector` | `*/15 * * * *` |
| Google Trends | `https://<worker>.zeabur.app/jobs/collect-google-trends` | `*/10 * * * *` |
| Incremental Assign | `https://<worker>.zeabur.app/jobs/incremental-assign` | `3,13,23,33,43,53 * * * *` |
| Nightly Recluster | `https://<worker>.zeabur.app/jobs/nightly-recluster` | `0 18 * * *` (02:00 HKT) |
| Daily Brief | `https://<worker>.zeabur.app/jobs/daily-brief` | `0 4 * * *` (12:00 HKT) |

### Step 9: ISR Revalidation

Add to Zeabur worker env:
- `REVALIDATION_URL=https://<app>.vercel.app/api/revalidate`
- `REVALIDATION_SECRET=<same-as-vercel>`

### Step 10: Smoke Test

1. Wait ~15 min for first QStash cron cycle
2. Check `scrape_runs` + `raw_posts` in Supabase
3. Check `topics` table after incremental-assign runs
4. Visit homepage — should show topic cards
5. Visit `/admin/login` → `/admin/status` — collector health

---

## Env Vars Reference

### Frontend (Vercel) — 9 vars
| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `REVALIDATION_SECRET` | Self-generated |
| `UPSTASH_REDIS_REST_URL` | Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash QStash |
| `QSTASH_NEXT_SIGNING_KEY` | Upstash QStash |
| `ADMIN_EMAILS` | Your email(s), comma-separated |

### Worker (Zeabur) — 12 vars
| Variable | Source |
|----------|--------|
| `SUPABASE_URL` | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `GOOGLE_AI_API_KEY` | Google AI Studio |
| `UPSTASH_REDIS_REST_URL` | Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash QStash |
| `QSTASH_NEXT_SIGNING_KEY` | Upstash QStash |
| `REVALIDATION_URL` | Vercel URL + /api/revalidate |
| `REVALIDATION_SECRET` | Same as Vercel |
| `SERPAPI_KEY` | SerpApi (optional fallback) |
| `TELEGRAM_BOT_TOKEN` | Telegram BotFather (optional) |
| `TELEGRAM_CHAT_ID` | Telegram (optional) |

### Edge Functions (Supabase Secrets) — 5-7 vars
| Variable | Source |
|----------|--------|
| `YOUTUBE_API_KEY` | Google Cloud Console |
| `UPSTASH_REDIS_REST_URL` | Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash QStash |
| `QSTASH_NEXT_SIGNING_KEY` | Upstash QStash |
| `PROXY_A_URL` | LIHKG proxy (optional) |
| `PROXY_B_URL` | LIHKG backup proxy (optional) |

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Collector 無 data | `scrape_runs` table error_message; Edge Functions logs; YouTube quota (10k/day) |
| Topics 無出現 | `raw_posts` 有 data？Incremental assign 有跑？Worker logs |
| 前端空白 | Vercel logs; `NEXT_PUBLIC_*` env vars correct？Browser console |
| Heat score 全 0 | `topics.heat_score` column; worker running？Need multi-platform data for diversity |
| LIHKG 被 ban | Check Redis `hottalk:lihkg:degradation_level`; auto-degrades L1→L2→L3 |

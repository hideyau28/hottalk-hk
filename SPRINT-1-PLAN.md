# Sprint 1 執行計劃 — Data Collection

> Branch: `claude/sprint-1-plan-KArni`
> 預設前提: Sprint 0 已完成 (repo, Vercel, Supabase project, Zeabur setup)

---

## Task 1: Database Schema Migration

### 建咩文件
- `supabase/migrations/0000_init_schema.sql`

### 依賴
- Supabase project 已建好 (Sprint 0 ✅)
- `pgvector` extension 已啟用

### 步驟

1. **啟用 extensions**
   - `CREATE EXTENSION IF NOT EXISTS "pgvector"` (embedding 1536 維)
   - `CREATE EXTENSION IF NOT EXISTS "pg_trgm"` (未來搜尋用，先啟用)

2. **建立 12 個 tables（按依賴順序）**
   - `scrape_runs` — 無外鍵依賴，最先建
   - `news_sources` — 無外鍵依賴
   - `raw_posts` — FK → scrape_runs
   - `topics` — self-referencing FK (canonical_id)
   - `topic_aliases` — FK → topics
   - `topic_posts` — FK → topics + raw_posts
   - `topic_history` — FK → topics
   - `entities` — 無外鍵依賴
   - `platform_daily_stats` — 無外鍵依賴
   - `content_reports` — FK → topics + raw_posts
   - `audit_log` — 無外鍵依賴
   - `sensitive_keywords` — 無外鍵依賴

3. **建立 indexes（按 spec 定義）**
   - `idx_raw_posts_processing` — partial index on `processing_status = 'pending'`
   - `idx_raw_posts_recent` — partial index on `published_at > NOW() - 48h`
   - `idx_raw_posts_hash` — content_hash 去重
   - `idx_topics_heat` — partial index on active statuses, heat_score DESC
   - `idx_topics_slug` — slug 查詢
   - `idx_topics_canonical` — canonical_id 查詢
   - `idx_topic_posts_topic` — topic_id 查詢
   - `idx_scrape_runs_recent` — started_at DESC

4. **RLS Policies**
   - `raw_posts`: anon + authenticated 可讀 (`SELECT`)
   - `topics`: anon + authenticated 可讀 (`SELECT`)
   - `topic_posts`: anon + authenticated 可讀 (`SELECT`)
   - `topic_aliases`: anon + authenticated 可讀 (`SELECT`)
   - `topic_history`: anon + authenticated 可讀 (`SELECT`)
   - `news_sources`: anon + authenticated 可讀 (`SELECT`)
   - `platform_daily_stats`: anon + authenticated 可讀 (`SELECT`)
   - `entities`: anon + authenticated 可讀 (`SELECT`)
   - `content_reports`: anon 可寫 (`INSERT`) — 用戶舉報唔需登入；無 SELECT（防濫用）
   - `audit_log`: service_role only（admin 用 server-side client）
   - `sensitive_keywords`: service_role only
   - `scrape_runs`: service_role only（只限 collector 寫入）

5. **Seed data**
   - `news_sources`: 8 個港媒 RSS 來源 (HK01, SCMP, 明報, 東網, 星島, 經濟日報, 有線新聞, 信報) + trust_weight
   - `entities`: 5+ 個常用 HK entities (MTR, 觀塘線, 深圳, LIHKG, 政府)
   - `sensitive_keywords`: 基本敏感字清單

### 關鍵約束（唔好改）
- `heat_score` 係 **INTEGER** (0-10000)，唔係 float
- `raw_posts.embedding` 係 `vector(1536)`
- `topics.centroid` 係 `vector(1536)`
- `UNIQUE(platform, platform_id)` on raw_posts
- `UNIQUE(topic_id, post_id)` on topic_posts
- `UNIQUE(platform, date)` on platform_daily_stats

---

## Task 2: YouTube Collector (Supabase Edge Function)

### 建咩文件
- `supabase/functions/youtube-collector/index.ts`

### 依賴
- Task 1 (DB schema) ✅
- YouTube Data API v3 key（env: `YOUTUBE_API_KEY`）
- Supabase service role key（env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`）

### 步驟

1. **Edge Function 骨架**
   - Deno + `serve()` handler
   - QStash signature 驗證（防外部觸發）
   - AbortController 120s timeout

2. **YouTube API 調用**
   - `GET /youtube/v3/videos?chart=mostPopular&regionCode=HK&maxResults=50&part=snippet,statistics`
   - 解析: videoId, title, description (前200字), channelTitle, viewCount, likeCount, commentCount, publishedAt, thumbnail
   - Error handling: quota exceeded → log + graceful fail

3. **view_count_delta_24h 計算**
   - 查詢 raw_posts 中同一 platform_id 嘅上次 view_count
   - delta = current_view_count - previous_view_count
   - 第一次抓取 → delta = view_count（全量作為 delta）

4. **去重 + 寫入 raw_posts**
   - `UPSERT` by `(platform, platform_id)`
   - 更新 engagement 欄位 (view_count, like_count, comment_count)
   - 新 post → `processing_status = 'pending'`
   - `content_hash = sha256(normalize(title))` — lowercase + strip punctuation + trim

5. **scrape_runs 記錄**
   - collector_name = `'youtube_collector'`
   - posts_fetched, posts_new, duration_ms, status
   - Error → status = `'failed'`, error_message 記錄

6. **QStash 排程配置**
   - 頻率: 每 15 分鐘
   - Endpoint: `https://<project-ref>.supabase.co/functions/v1/youtube-collector`

---

## Task 3: News RSS Collector (Supabase Edge Function)

### 建咩文件
- `supabase/functions/news-collector/index.ts`

### 依賴
- Task 1 (DB schema + news_sources seed data) ✅
- Supabase service role key

### 步驟

1. **Edge Function 骨架**
   - 同 YouTube collector 結構
   - QStash signature 驗證
   - AbortController 120s timeout

2. **RSS 來源配置**
   - 從 DB `news_sources` table 讀取 `WHERE is_active = TRUE`
   - 8 個港媒: HK01, SCMP, 明報, 東網, 星島, 經濟日報, 有線新聞, 信報
   - 各 source 有 `trust_weight`（news heat_score 計算用）

3. **RSS 解析**
   - 用 Deno 原生 XML parser 或輕量 RSS parser
   - 提取: title, link, pubDate, source/author, description, imageUrl (enclosure/media:content)
   - 處理 CDATA sections、不同 date format

4. **canonical_url + content_hash 去重**
   - `canonical_url`: strip tracking params (?utm_*, ?fbclid, etc.)
   - `content_hash = sha256(normalize(title))`
   - UPSERT by `(platform, platform_id)` where platform_id = canonical_url hash
   - 額外用 content_hash 檢查跨 source 轉載重複

5. **寫入 raw_posts**
   - platform = `'news'`
   - author_name = news source name（用於 heat_score trust_weight lookup）
   - content_policy = `'metadata_only'`
   - processing_status = `'pending'`

6. **scrape_runs 記錄**
   - collector_name = `'news_collector'`
   - 每個 source 可獨立記錄 status（partial success 如果部分 source 失敗）

7. **QStash 排程配置**
   - 頻率: 每 5 分鐘
   - 併發處理多個 RSS feed（Promise.allSettled）

---

## Task 4: Google Trends Collector (Python Worker / Zeabur)

### 建咩文件
- `worker/collectors/google_trends.py`
- `worker/main.py`（加 route）
- `worker/requirements.txt`（加 pytrends）
- `worker/Dockerfile`

### 依賴
- Task 1 (DB schema) ✅
- Zeabur Python worker 已 setup (Sprint 0)
- `pytrends` library
- SerpApi key（optional fallback, env: `SERPAPI_KEY`）
- Supabase credentials（env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`）

### 步驟

1. **FastAPI Worker 骨架（如尚未建立）**
   - `worker/main.py`: FastAPI app + health endpoint
   - QStash webhook signature 驗證 middleware
   - structlog JSON logging
   - Supabase client init (supabase-py)

2. **pytrends integration**
   - `TrendReq(hl='zh-HK', geo='HK')`
   - `trending_searches(pn='hong_kong')` — 即時熱搜
   - `realtime_trending_searches(pn='HK')` — 即時趨勢（如果 available）
   - 提取: keyword, traffic_volume (stored as view_count), related_queries

3. **SerpApi fallback**
   - 如果 pytrends 失敗（rate limit / 結構改變）
   - `GET https://serpapi.com/search?engine=google_trends&geo=HK`
   - 只在 pytrends 連續失敗 2 次後切換

4. **寫入 raw_posts**
   - platform = `'google_trends'`
   - platform_id = `f"gtrends_{keyword}_{date}"`
   - title = keyword
   - view_count = traffic_volume（heat_score 用 `max(view_count)`）
   - url = Google Trends search URL
   - content_hash = sha256(normalize(keyword))
   - processing_status = `'pending'`
   - 去重: UPSERT by (platform, platform_id)

5. **scrape_runs 記錄**
   - collector_name = `'google_trends_collector'`
   - 記錄用咗 pytrends 定 SerpApi

6. **FastAPI route**
   - `POST /jobs/collect-google-trends`
   - QStash webhook 觸發
   - 頻率: 每 30 分鐘

7. **Docker + requirements**
   - `requirements.txt`: fastapi, uvicorn, supabase, pytrends, serpapi, structlog, httpx
   - `Dockerfile`: Python 3.11 slim, pip install, uvicorn serve

---

## Task 5: LIHKG Collector with 3-Tier Degradation (Supabase Edge Function)

### 建咩文件
- `supabase/functions/lihkg-collector/index.ts`

### 依賴
- Task 1 (DB schema) ✅
- Rotating proxy 配置（env: `PROXY_A_URL`, `PROXY_B_URL`）
- Supabase service role key
- Upstash Redis（用於降級狀態追蹤, env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`）

### 步驟

1. **Edge Function 骨架**
   - QStash signature 驗證
   - AbortController 120s timeout（Edge Function limit ~150s）
   - Upstash Redis client init（追蹤降級狀態）

2. **降級狀態管理（Redis）**
   - Key: `hottalk:lihkg:degradation_level` → `'L1'` | `'L2'` | `'L3'`
   - Key: `hottalk:lihkg:consecutive_failures` → integer
   - 每次成功 → reset to L1, failures = 0
   - L1→L2 觸發: 連續 3 次 403/429 OR 連續 2 次 timeout
   - L2→L3 觸發: proxy B 亦被封（連續 3 次失敗）

3. **L1 正常模式**
   - 非官方 API via Proxy A
   - `GET https://lihkg.com/api_v2/thread/hot?cat_id=1&page=1&count=50`
   - 頻率: 每 10 分鐘
   - 數據: threadId, title, replyCount, likeCount, dislikeCount, authorName
   - Proxy: `PROXY_A_URL`

4. **L2 降級模式**
   - 同 L1 API 但切換 Proxy B
   - 頻率: 每 30 分鐘（QStash schedule 唔變，但 Edge Function 內部 check 時間間隔）
   - 實現: 用 Redis `hottalk:lihkg:last_l2_fetch` 控制頻率
   - 如果距上次 fetch < 30 分鐘 → skip + early return

5. **L3 最低模式**
   - Simple HTTP fetch（唔經 API）
   - 只抓 hot list 頁面 HTML → parse title + url
   - 頻率: 每 60 分鐘（同 L2，用 Redis timestamp 控制）
   - data_quality = `'degraded'`
   - engagement 數據全部為 0（無法取得）

6. **寫入 raw_posts**
   - platform = `'lihkg'`
   - platform_id = `f"lihkg_{threadId}"`
   - content_policy = `'metadata_only'`（唔存全文）
   - processing_status = `'pending'`
   - content_hash = sha256(normalize(title))
   - UPSERT by (platform, platform_id)

7. **scrape_runs 記錄**
   - collector_name = `'lihkg_collector'`
   - degradation_level = 當前 level
   - proxy_id = proxy hash（合規追溯）
   - status = `'success'` | `'partial'` | `'failed'` | `'degraded'`
   - 403/429 → 記錄 status_code

8. **Error handling + exponential backoff**
   - 403/429 → increment failure counter → check 降級
   - Timeout → increment failure counter
   - Network error → retry 1 次 → 仍失敗 → record + skip
   - 所有 error 記錄到 scrape_runs

9. **QStash 排程配置**
   - 頻率: 每 10 分鐘（固定）
   - Edge Function 內部根據 degradation level 決定是否 skip

---

## 共用依賴 / 需要額外建嘅文件

| 文件 | 用途 | 屬於邊個 Task |
|------|------|-------------|
| `supabase/functions/_shared/supabase-client.ts` | Edge Functions 共用 Supabase client | Task 2, 3, 5 |
| `supabase/functions/_shared/qstash-verify.ts` | QStash webhook 簽名驗證 | Task 2, 3, 5 |
| `supabase/functions/_shared/utils.ts` | normalize title, sha256, strip tracking params | Task 2, 3, 5 |
| `worker/utils/supabase_client.py` | Python worker Supabase client | Task 4 |
| `worker/utils/qstash_verify.py` | QStash webhook 簽名驗證 (Python) | Task 4 |
| `src/lib/types.ts` | TypeScript types 對應 DB schema | Task 1 後建 |
| `.env.local.example` | 更新所有需要嘅 env vars | 全部 |

---

## 執行順序

```
Task 1 (DB Schema)
    ├── Task 2 (YouTube) ─── 可同時開始 ──┐
    ├── Task 3 (News RSS) ── 可同時開始 ──┤
    ├── Task 4 (Google Trends) ── 可同時 ─┤
    └── Task 5 (LIHKG) ──── 可同時開始 ──┘
```

Task 1 必須最先完成。Task 2-5 互不依賴，可以並行。

建議實際順序: **Task 1 → Task 2 → Task 3 → Task 4 → Task 5**
（由簡到複雜，YouTube 最穩定先做 smoke test）

---

## Env Vars 清單

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# YouTube
YOUTUBE_API_KEY=

# Google Trends (optional fallback)
SERPAPI_KEY=

# LIHKG Proxy
PROXY_A_URL=
PROXY_B_URL=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# QStash
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

---

## Commit 規範

每個 Task 完成後獨立 commit:
- `Sprint 1: Add database schema migration (12 tables + indexes + RLS)`
- `Sprint 1: Add YouTube collector Edge Function`
- `Sprint 1: Add News RSS collector Edge Function`
- `Sprint 1: Add Google Trends collector (Python worker)`
- `Sprint 1: Add LIHKG collector with 3-tier degradation`

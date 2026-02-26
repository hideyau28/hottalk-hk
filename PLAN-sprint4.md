# Sprint 4: Admin + Stability — 實施計劃

## 總覽

7 個 Tasks，涉及 13 個新文件 + 4 個修改文件。以下按依賴順序排列。

---

## Task 6: Admin Auth Setup（最先做，其他 admin 頁依賴佢）

### 建咩文件
1. **`src/middleware.ts`** — Next.js middleware，攔截 `/admin/*` 路徑
2. **`src/lib/supabase-auth.ts`** — Supabase Auth helper（SSR session 讀取）

### 修改文件
- **`src/lib/supabase.ts`** — 加 `createAuthServerClient()` 用 cookies 讀 session
- **`.env.local.example`** — 加 `ADMIN_EMAILS` 環境變量

### 依賴
- `@supabase/ssr` package（需 npm install）

### 步驟
1. `npm install @supabase/ssr`
2. 建 `src/lib/supabase-auth.ts`：
   - `createAuthServerClient(cookieStore)` — 用 `@supabase/ssr` 嘅 `createServerClient` 讀 session cookies
   - `isAdminUser(email)` — 對比 `ADMIN_EMAILS` env var（逗號分隔嘅 email list）
3. 建 `src/middleware.ts`：
   - matcher: `/admin/:path*`
   - 讀 Supabase session cookie
   - 無 session → redirect `/admin/login`
   - 有 session 但 email 唔喺 ADMIN_EMAILS → 403 response
   - 通過 → `NextResponse.next()`
4. 建 `src/app/admin/login/page.tsx`：
   - 簡單 email + password form（`'use client'`）
   - 用 `createBrowserClient()` call `supabase.auth.signInWithPassword()`
   - 成功 → redirect `/admin/topic-review`
5. 建 `src/app/admin/layout.tsx`：
   - Admin shell layout：sidebar nav（Topic Review / Status Dashboard）+ logout 按鈕
   - Server Component，讀 session 顯示 admin email

---

## Task 3: Monitoring - Redis Error Counters（Task 1, 2, 4 都依賴佢）

### 建咩文件
1. **`worker/utils/monitoring.py`** — Redis counter 操作

### 依賴
- 現有 `upstash-redis` package（已喺 requirements.txt）

### 步驟
1. 建 `worker/utils/monitoring.py`：
   - Constants：
     - `OK_KEY_PREFIX = "hottalk:ok"`
     - `ERR_KEY_PREFIX = "hottalk:err"`
     - TTL = 86400 * 3（3 日）
   - `async def record_ok(collector: str) -> None`：
     - Key: `hottalk:ok:{collector}:{YYYY-MM-DD}`
     - INCR + EXPIRE（3 日 TTL）
   - `async def record_error(collector: str, error_msg: str = "") -> None`：
     - Key: `hottalk:err:{collector}:{YYYY-MM-DD}`
     - INCR + EXPIRE
   - `async def get_counters(collector: str, date: str) -> dict[str, int]`：
     - 讀取 ok + err count，return `{"ok": N, "err": M}`
   - `async def get_all_counters_today() -> dict[str, dict[str, int]]`：
     - 讀取所有已知 collectors 嘅今日 counters
     - Collectors list: `["youtube_collector", "news_collector", "lihkg_collector", "google_trends_collector", "incremental_assign", "nightly_recluster", "summarize"]`
   - `async def get_consecutive_failures(collector: str) -> int`：
     - Key: `hottalk:consecutive_err:{collector}`
     - GET 返回 int
   - `async def increment_consecutive_failures(collector: str) -> int`：
     - INCR + EXPIRE 24h
   - `async def reset_consecutive_failures(collector: str) -> None`：
     - DEL key
   - 所有 function 用 try-except wrap Redis calls，失敗只 log 唔 raise

---

## Task 4: Telegram Alert

### 建咩文件
1. **`worker/utils/alerting.py`** — Telegram Bot 通知

### 修改文件
- **`.env.local.example`** — 加 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- **`worker/requirements.txt`** — 確認 `httpx` 已存在（已有）

### 依賴
- Task 3 (monitoring.py) — 讀取 consecutive failures + counters

### 步驟
1. 建 `worker/utils/alerting.py`：
   - Constants：
     - `CONSECUTIVE_FAIL_THRESHOLD = 5`
     - `LLM_COST_WARNING = 0.08`（USD）
     - `LLM_COST_HARD_STOP = 0.15`
     - `ZERO_TOPICS_HOURS = 6`
     - `TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"`
   - `async def send_telegram_alert(message: str) -> bool`：
     - 讀 `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from env
     - POST to Telegram Bot API（httpx, timeout 10s）
     - try-except，失敗只 log
   - `async def check_and_alert_collector(collector: str, success: bool) -> None`：
     - 如果 success → `reset_consecutive_failures(collector)`
     - 如果 fail → `increment_consecutive_failures(collector)`
     - 如果 consecutive ≥ THRESHOLD → `send_telegram_alert("🚨 {collector} 連續失敗 {N} 次")`
   - `async def check_lihkg_degradation(level: str) -> None`：
     - 如果 level == "L3" → send alert
   - `async def check_llm_cost() -> str | None`：
     - 讀 Redis `hottalk:llm_tokens:{today}`
     - 估算 cost（token × $0.25/1M input + $1.25/1M output，保守用 avg $0.80/1M）
     - \> $0.15 → return "hard_stop"（caller 應停止 summarization）
     - \> $0.08 → send warning alert，return "warning"
     - otherwise → return None
   - `async def check_zero_topics(hours: int = 6) -> None`：
     - Query `topics` table: `WHERE first_detected_at > NOW() - INTERVAL '{hours} hours'`
     - Count = 0 → send alert
   - `async def check_worker_health(health_url: str) -> None`：
     - GET health endpoint，non-200 or exception → send alert

---

## Task 1: Admin Topic Review 頁

### 建咩文件
1. **`src/app/admin/topic-review/page.tsx`** — 主頁面（Server Component，data fetching）
2. **`src/app/admin/topic-review/actions.ts`** — Server Actions（confirm/merge/split/spam）
3. **`src/app/admin/topic-review/topic-review-client.tsx`** — Client Component（互動 UI）

### 依賴
- Task 6 (Auth) — middleware 保護
- 現有 `src/lib/supabase.ts` — data fetching
- 現有 `src/lib/types.ts` — Topic, RawPost, AuditLogEntry types

### 步驟
1. 建 `src/app/admin/topic-review/actions.ts`（Server Actions）：
   - `confirmTopic(topicId: string)` —
     - Set flags = array_remove('suspected_spam')
     - Insert audit_log: entity_type='topic', action='manual_review', actor='admin', details={action:'confirm'}
   - `markSpam(topicId: string)` —
     - Set status='archive', flags=append('suspected_spam'), summary_status='hidden'
     - Insert audit_log
   - `mergeTopics(sourceId: string, targetId: string)` —
     - Update source: canonical_id=targetId, status='archive'
     - Move topic_posts from source → target
     - Create topic_alias for source slug
     - Recalc target post_count, source_count
     - Insert audit_log
   - `splitTopic(topicId: string, postIds: string[])` —
     - 驗證 topic age < 48h（CLAUDE.md rule #7）
     - Create new topic with selected posts
     - Remove selected topic_posts from original
     - Insert audit_log for both topics
   - 所有 action 結束 call `revalidatePath('/admin/topic-review')`

2. 建 `src/app/admin/topic-review/page.tsx`（Server Component）：
   - Fetch heat_score top 20 topics（WHERE canonical_id IS NULL, status IN active）
   - Fetch all flagged topics（WHERE array_length(flags) > 0）
   - 合併兩個 list（去重）
   - 對每個 topic fetch 所屬 posts（via topic_posts JOIN raw_posts）
   - Pass data to client component

3. 建 `src/app/admin/topic-review/topic-review-client.tsx`（Client Component）：
   - `'use client'`
   - 每個 topic card 顯示：
     - title, slug, heat_score, status, flags, post_count, source_count
     - Expandable section: 顯示所有 posts（platform badge + title + url）
   - 操作按鈕：
     - ✅確認 — call `confirmTopic()`
     - 🔀合併 — 打開 modal 選擇 target topic
     - ✂️拆分 — checkbox 選 posts → call `splitTopic()`
     - 🗑️標記 spam — confirmation dialog → call `markSpam()`
   - 每個操作用 `useTransition()` 處理 loading state
   - Toast/alert 顯示操作結果

---

## Task 2: Admin Status Dashboard

### 建咩文件
1. **`src/app/admin/status/page.tsx`** — Status Dashboard（Server Component）
2. **`src/app/api/admin/status/route.ts`** — API route（Redis counters + DB queries）

### 依賴
- Task 6 (Auth) — middleware 保護
- Task 3 (monitoring.py) — Redis counter format 要一致

### 步驟
1. 建 `src/app/api/admin/status/route.ts`：
   - GET handler
   - 用 service role Supabase client
   - Query `scrape_runs`：最近 24h 各 collector 嘅 success/failed 數
   - Query Redis：讀 `hottalk:ok:*` + `hottalk:err:*` counters（今日）
   - Query Redis：讀 `hottalk:llm_tokens:{today}` → 計算 cost
   - Query Redis：讀 `hottalk:lihkg:degradation_level`
   - Query `scrape_runs`：各 platform 最後成功抓取時間
   - Return JSON

2. 建 `src/app/admin/status/page.tsx`：
   - `'use client'`（需要 auto-refresh）
   - `useEffect` + `setInterval` 每 30 秒 fetch `/api/admin/status`
   - Table 1: Collector Status
     - Columns: Collector | 成功 | 失敗 | 最後成功 | 狀態
     - Rows: youtube, news, lihkg, google_trends
   - Table 2: AI Pipeline
     - incremental_assign: runs today, last success
     - nightly_recluster: last run, status
     - summarize: topics summarized today
   - Table 3: LLM Usage
     - 今日 tokens used / 500K cap
     - 估算 cost (USD)
     - Progress bar
   - Card: LIHKG 降級 Level（L1/L2/L3 顯示不同顏色）
   - 簡單 Tailwind table styling，唔需要 shadcn

---

## Task 5: Graceful Degradation 驗證

### 修改文件
1. **`worker/collectors/google_trends.py`** — 確認 try-catch + scrape_runs（已有 ✅）
2. **`worker/main.py`** — 加 monitoring.record_ok/record_error + alerting calls
3. **`worker/jobs/summarize.py`** — 加 LLM cost check + hard stop 邏輯

### 依賴
- Task 3 (monitoring.py) — counter functions
- Task 4 (alerting.py) — alert functions

### 步驟
1. 驗證現有 collectors 嘅 error handling：
   - `supabase/functions/youtube-collector/index.ts` — ✅ 已有 try-catch + finalizeScrapeRun
   - `supabase/functions/news-collector/index.ts` — ✅ 已有 try-catch + finalizeScrapeRun
   - `supabase/functions/lihkg-collector/index.ts` — ✅ 已有 try-catch + degradation + finalizeScrapeRun
   - `worker/collectors/google_trends.py` — ✅ 已有 try-catch + _finalize_run

2. 修改 `worker/main.py`：每個 job endpoint 加入：
   - `try` block success → `await record_ok(collector_name)`  + `await reset_consecutive_failures(collector_name)`
   - `except` block → `await record_error(collector_name)` + `await check_and_alert_collector(collector_name, success=False)`
   - Google Trends collector endpoint 同樣加入
   - Incremental assign / nightly recluster 同理

3. 修改 `worker/jobs/summarize.py`：
   - 喺 `summarize_topics()` 入面，每個 topic loop 前 call `check_llm_cost()`
   - 如果 return "hard_stop" → skip + send alert + break
   - AI down（LLM call exception all retries failed）→ topic 保留 raw titles（summary_status='failed'，已有 ✅）

4. LIHKG L3 → `data_quality='degraded'`：
   - 已喺 `lihkg-collector/index.ts` line 156 實現 ✅

---

## Task 7: AI Pipeline Stability

### 建咩文件
- 無新文件

### 修改文件
1. **`worker/jobs/incremental_assign.py`** — 加 timeout + job_run logging
2. **`worker/jobs/nightly_recluster.py`** — 加 timeout + job_run logging
3. **`worker/main.py`** — 加 asyncio timeout wrapper

### 依賴
- Task 3 (monitoring.py)

### 步驟
1. 修改 `worker/main.py`：
   - Import `asyncio`
   - 每個 job endpoint 加 `asyncio.wait_for(coroutine, timeout=300)`（5 分鐘）
   - Timeout → log error + record_error + return 504
   - 同時記錄 job run 到 `scrape_runs` table（用 collector_name='incremental_assign' / 'nightly_recluster'）

2. 修改 `worker/jobs/incremental_assign.py`：
   - 開頭建 scrape_run record（status='running', collector_name='incremental_assign', platform='all'）
   - 結尾更新 scrape_run（status='success'/'failed', duration_ms, posts_new 等）
   - 確保整個 function body 喺 try-except 內

3. 修改 `worker/jobs/nightly_recluster.py`：
   - 同上 pattern — scrape_run record lifecycle
   - 確保 HDBSCAN failure 唔會 crash entire job
   - 確保 merge 操作 atomic（如果 merge 中途失敗，要 rollback or skip）

---

## 執行順序

```
Task 6 (Auth)  ──→  Task 1 (Topic Review)
                ──→  Task 2 (Status Dashboard)

Task 3 (Monitoring) ──→  Task 4 (Alerting)
                    ──→  Task 5 (Degradation)
                    ──→  Task 7 (Pipeline Stability)
```

建議 batch：
1. **Batch A**（先做）: Task 6 → Task 3 → Task 4
2. **Batch B**（之後）: Task 1 + Task 2（可並行）
3. **Batch C**（最後）: Task 5 + Task 7（修改現有 code）

---

## 新文件清單

| # | 文件路徑 | Task |
|---|---------|------|
| 1 | `src/middleware.ts` | 6 |
| 2 | `src/lib/supabase-auth.ts` | 6 |
| 3 | `src/app/admin/login/page.tsx` | 6 |
| 4 | `src/app/admin/layout.tsx` | 6 |
| 5 | `worker/utils/monitoring.py` | 3 |
| 6 | `worker/utils/alerting.py` | 4 |
| 7 | `src/app/admin/topic-review/page.tsx` | 1 |
| 8 | `src/app/admin/topic-review/actions.ts` | 1 |
| 9 | `src/app/admin/topic-review/topic-review-client.tsx` | 1 |
| 10 | `src/app/admin/status/page.tsx` | 2 |
| 11 | `src/app/api/admin/status/route.ts` | 2 |

## 修改文件清單

| # | 文件路徑 | Task |
|---|---------|------|
| 1 | `.env.local.example` | 6, 4 |
| 2 | `worker/main.py` | 5, 7 |
| 3 | `worker/jobs/summarize.py` | 5 |
| 4 | `worker/requirements.txt` | (無需改，httpx 已有) |
| 5 | `package.json` | 6 (加 @supabase/ssr) |

---

## 注意事項

- Admin user 手動喺 Supabase dashboard 建（email/password），唔需要 signup flow
- `ADMIN_EMAILS` env var 控制邊個 email 係 admin
- 所有 admin API route 都經 middleware auth 保護
- Audit log 每個操作都寫（符合 CLAUDE.md 要求）
- Topic > 48h 唔準 split（CLAUDE.md rule #7）
- Heat score 係 INTEGER 0-10000（唔會改）
- LLM cost 估算用保守 avg rate（$0.80/1M tokens）

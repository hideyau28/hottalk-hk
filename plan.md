# Sprint 3: Frontend Core — 實施計劃

## 現狀分析

- **已有**: Next.js 16 scaffold (App Router)、`src/lib/types.ts` (所有 DB types)、Tailwind v4、`@supabase/supabase-js`、`@upstash/redis`
- **未有**: `src/lib/supabase.ts`、`src/lib/redis.ts`、所有 components、所有 pages (只有 Next.js default template)
- **需要安裝**: `@upstash/ratelimit` (Report API rate limit)、`@upstash/qstash` (webhook 驗證)
- **Tailwind v4**: 用 `@import "tailwindcss"` + `@theme inline` 語法，冇 `tailwind.config.ts`
- **shadcn/ui**: 未安裝。因為 Tailwind v4 + Next.js 16 (React 19) 環境，Sprint 3 用**手寫 Tailwind 組件**（shadcn 風格），保持 shadcn-like API 以便將來遷移。

---

## Task 0: 依賴安裝 + 全域配置

**建咩文件**: 修改 `package.json`、`next.config.ts`、`.env.local.example`
**依賴**: 無
**步驟**:
1. `npm install @upstash/ratelimit @upstash/qstash`
2. 更新 `next.config.ts` — 設定 `images.remotePatterns` (YouTube thumbnails: `i.ytimg.com`)
3. 更新 `.env.local.example` — 加入 `REVALIDATION_SECRET`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Task 1: Root Layout + 全域設定

**建咩文件**: 修改 `src/app/layout.tsx`、`src/app/globals.css`
**依賴**: Task 0
**步驟**:
1. **layout.tsx**:
   - 移除 Geist 字體，改用 `Noto_Sans_HK` from `next/font/google`（weight: 400, 500, 700）
   - `<html lang="zh-HK">`
   - Metadata:
     ```ts
     title: { default: '熱話 HotTalk HK — 一頁睇晒，全港熱話', template: '%s | 熱話 HotTalk HK' }
     description: '香港首個免費跨平台社交媒體熱點聚合平台。AI 自動歸納 YouTube、連登、新聞、Google Trends 熱話。'
     ```
   - OG tags 模板 (openGraph):
     ```ts
     siteName: '熱話 HotTalk HK'
     locale: 'zh_HK'
     type: 'website'
     ```
   - viewport (透過 Next.js `viewport` export):
     ```ts
     export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 }
     ```
   - robots: `index, follow`
   - `<body>` 用 Noto Sans HK variable class + `antialiased`
   - 簡單 header: 站名 🔥 熱話 HotTalk HK + tagline
   - 簡單 footer: © 2026 HotTalk HK

2. **globals.css**:
   - 更新 `@theme inline` 加入 `--font-noto` variable
   - 保留 dark mode CSS vars (唔 implement toggle)
   - 加基礎 utility: smooth scroll、selection color

---

## Task 7: Supabase + Redis Client（提前做，因為其他 Tasks 依賴）

**建咩文件**: 新建 `src/lib/supabase.ts`、`src/lib/redis.ts`
**依賴**: Task 0 (env vars)
**步驟**:

1. **supabase.ts**:
   - `createServerClient()` — 用 `@supabase/supabase-js` `createClient()` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`（server components / route handlers）
   - `createBrowserClient()` — 用 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`（client components）
   - Export typed helpers
   - 唔用 `@supabase/ssr`，MVP 無 Auth flow，直接用 `supabase-js`

2. **redis.ts**:
   - `Redis` instance from `@upstash/redis`
   - `Ratelimit` instance from `@upstash/ratelimit`（sliding window, 5 req/min）
   - Export both

3. 更新 `.env.local.example` 加 `NEXT_PUBLIC_SUPABASE_URL` 同 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Task 8: 共用 Components

**建咩文件**: `src/components/` 下 8 個檔案
**依賴**: Task 1 (layout/fonts)、Task 7 (types)
**步驟**:

1. **`src/components/heat-indicator.tsx`** (Server Component)
   - Props: `{ score: number }` (0-10000)
   - 顯示: 🔥 x N (1-5 個火) + 數字
   - 分級: 0-2000=1🔥, 2001-4000=2🔥, 4001-6000=3🔥, 6001-8000=4🔥, 8001-10000=5🔥
   - 顏色: 按級別 amber → orange → red

2. **`src/components/platform-badge.tsx`** (Server Component)
   - Props: `{ platform: Platform; count?: number }`
   - YouTube=📺, LIHKG=💬, News=📰, Google Trends=🔍
   - 小 pill badge 樣式

3. **`src/components/sentiment-bar.tsx`** (Server Component)
   - Props: `{ positive: number; negative: number; neutral: number }`
   - 橫向 stacked bar (green/red/gray)
   - 百分比 labels

4. **`src/components/platform-tabs.tsx`** (Client Component — `"use client"`)
   - Props: `{ activeTab: string }`
   - Tabs: [🔥全部] [📺YouTube] [💬連登] [📰新聞] [🔍Google]
   - 用 URL search params `?platform=youtube` 作 filter
   - `useRouter` + `useSearchParams` for navigation
   - Sticky on mobile (sticky top-0)

5. **`src/components/time-ago.tsx`** (Client Component — `"use client"`)
   - Props: `{ date: string }`
   - 顯示:「X 分鐘前」「X 小時前」「X 日前」
   - 每分鐘 auto-refresh (useEffect + setInterval)

6. **`src/components/report-button.tsx`** (Client Component — `"use client"`)
   - Props: `{ topicId: string }`
   - ⚠️ 按鈕 → 展開選擇 reason dropdown
   - Reasons: AI 摘要不準確 / 話題合併錯誤 / 包含個人私隱 / 包含不當內容 / 其他
   - Submit → POST `/api/report`
   - Success/error feedback (inline message)

7. **`src/components/topic-card.tsx`** (Server Component)
   - Props: `{ topic: Topic; rank: number }`
   - 組合子組件: 排名 + 標題 (link to `/topic/${slug}`)、HeatIndicator、PlatformBadge 列（從 `platforms_json` 解析）、AI 摘要 (2 行 `line-clamp-2`)、SentimentBar、ReportButton
   - Mobile: full-width card

8. **`src/components/ad-slot.tsx`** (Server Component)
   - Placeholder div，帶 `data-ad-slot` attribute
   - 灰色虛線框 + 「廣告」label

---

## Task 2: 首頁 — 全港熱話牆

**建咩文件**: 修改 `src/app/page.tsx`
**依賴**: Task 7 (supabase client)、Task 8 (components)
**步驟**:
1. `export const revalidate = 300` (ISR 5 min)
2. Server Component — `async function HomePage()`
3. 接收 `searchParams` → 讀 `platform` filter
4. Supabase query:
   ```sql
   SELECT id, slug, title, summary, summary_status, heat_score,
          total_engagement, source_count, post_count,
          sentiment_positive, sentiment_negative, sentiment_neutral,
          status, platforms_json, last_updated_at, report_count, flags
   FROM topics
   WHERE status IN ('emerging', 'rising', 'peak')
     AND canonical_id IS NULL
     AND NOT ('suspected_spam' = ANY(flags))
     AND report_count < 5
   ORDER BY heat_score DESC
   LIMIT 50
   ```
   - 如果有 `platform` filter → 加 `platforms_json ? :platform` 條件
5. 渲染:
   - PlatformTabs (sticky header)
   - 「更新於 X 分鐘前」(用最新 topic 嘅 `last_updated_at`)
   - TopicCard 列表
   - 每 4 個 card 後插入 AdSlot
6. 空 state: topics.length === 0 → 「熱話即將上線」coming soon 畫面

---

## Task 3: 話題詳情頁

**建咩文件**: 新建 `src/app/topic/[slug]/page.tsx`
**依賴**: Task 7、Task 8
**步驟**:
1. **generateStaticParams()**: 預生成 top 50 topics (by heat_score)
2. **generateMetadata()**: 動態 SEO
   - title: `${topic.title} | 熱話 HotTalk HK`
   - description: `topic.meta_description || topic.summary?.slice(0, 160)`
   - openGraph: title, description, type='article'
   - canonical: `https://hottalk.hk/topic/${slug}`
3. **301 Redirect**: 先查 `topic_aliases` — 如果 slug 係 alias → `redirect()` 到 canonical slug (permanent)
4. **主內容**:
   - Topic title (h1)
   - HeatIndicator (大版)
   - 完整 AI summary (full text)
   - Sentiment bar (大版 + 百分比數字)
   - PlatformBadge 行
5. **相關 Posts 列表**:
   ```sql
   SELECT rp.*, tp.similarity_score
   FROM topic_posts tp
   JOIN raw_posts rp ON rp.id = tp.post_id
   WHERE tp.topic_id = :topic_id
   ORDER BY rp.published_at DESC
   ```
   - 按平台分組顯示
   - 每個 post: title (link to original URL)、platform badge、published_at、engagement
6. **JSON-LD** structured data:
   - `Article`: headline, datePublished, description, author
   - `BreadcrumbList`: 首頁 → 話題標題
7. ISR: `export const revalidate = 300`

---

## Task 4: Platform Pages

**建咩文件**: 新建 5 個檔案
- `src/app/platform/layout.tsx`
- `src/app/platform/youtube/page.tsx`
- `src/app/platform/lihkg/page.tsx`
- `src/app/platform/news/page.tsx`
- `src/app/platform/google-trends/page.tsx`

**依賴**: Task 7、Task 8
**步驟**:
1. **共用 layout** (`platform/layout.tsx`):
   - PlatformTabs navigation (highlight 當前 tab)
   - 共通 metadata template
2. **每個 platform page** (ISR revalidate=300):
   ```sql
   SELECT * FROM raw_posts
   WHERE platform = :platform
     AND published_at > NOW() - INTERVAL '48 hours'
   ORDER BY (view_count + like_count * 2 + comment_count * 3) DESC
   LIMIT 50
   ```
   - 顯示 raw_post cards: title, author, engagement metrics, published_at, thumbnail
   - Link 到原文 URL
3. **Platform-specific 差異**:
   - YouTube: thumbnail、view_count、like_count
   - LIHKG: reply_count (comment_count)、like/dislike ratio
   - News: source name、published_at
   - Google Trends: traffic volume (view_count)

---

## Task 5: On-demand Revalidation API

**建咩文件**: 新建 `src/app/api/revalidate/route.ts`
**依賴**: Task 0 (`@upstash/qstash`)
**步驟**:
1. POST handler
2. 驗證 QStash signature（用 `@upstash/qstash` 嘅 `Receiver`）
3. Parse body: `{ paths?: string[], slugs?: string[] }`
4. `revalidatePath('/')` — 永遠 revalidate 首頁
5. 如果有 `slugs` → `revalidatePath('/topic/${slug}')` for each
6. 如果有 `paths` → `revalidatePath(path)` for each
7. Return `{ revalidated: true, paths: [...] }`
8. Error: 401 if signature invalid, 500 if revalidation fails

---

## Task 6: Report API

**建咩文件**: 新建 `src/app/api/report/route.ts`
**依賴**: Task 7 (supabase + redis)
**步驟**:
1. POST handler
2. Rate limit check: `Ratelimit` from redis.ts — 5 req/min per IP
   - IP from `x-forwarded-for` 或 `x-real-ip`
   - 429 if exceeded
3. Parse body: `{ topic_id: string, reason: string, details?: string }`
4. Validate reason 係 predefined values
5. Hash IP (SHA-256) before storing
6. Insert into `content_reports`
7. Increment `topics.report_count`
8. report_count >= 3 → update `topics.summary_status = 'hidden'`
9. report_count >= 5 → update `topics.status = 'archive'`, add flag `reported`
10. Return `{ success: true }`

---

## 執行順序

```
Task 0 (依賴安裝)
  ↓
Task 1 (Layout) + Task 7 (Clients) — 並行
  ↓
Task 8 (Components) — 依賴 Task 1 + 7
  ↓
Task 2 (首頁) + Task 3 (話題頁) + Task 4 (Platform Pages) — 並行
  ↓
Task 5 (Revalidation API) + Task 6 (Report API) — 並行
  ↓
Build 驗證 (npm run build)
  ↓
Commit + Push
```

---

## 預計產出文件清單 (20 個)

### 修改 (6)
| 檔案 | 變更 |
|------|------|
| `package.json` | 新依賴 @upstash/ratelimit, @upstash/qstash |
| `next.config.ts` | images remotePatterns |
| `.env.local.example` | 新 env vars |
| `src/app/layout.tsx` | 全新 layout (Noto Sans HK, meta, OG) |
| `src/app/globals.css` | Tailwind theme 更新 |
| `src/app/page.tsx` | 全港熱話牆 |

### 新建 (14)
| 檔案 | 描述 |
|------|------|
| `src/lib/supabase.ts` | Supabase server + browser clients |
| `src/lib/redis.ts` | Redis + Ratelimit |
| `src/components/topic-card.tsx` | 話題卡片 |
| `src/components/platform-badge.tsx` | 平台 badge |
| `src/components/sentiment-bar.tsx` | 情緒分析條 |
| `src/components/heat-indicator.tsx` | 熱度指示器 |
| `src/components/platform-tabs.tsx` | 平台 tab 切換 |
| `src/components/report-button.tsx` | 舉報按鈕 |
| `src/components/time-ago.tsx` | 相對時間顯示 |
| `src/components/ad-slot.tsx` | 廣告位預留 |
| `src/app/topic/[slug]/page.tsx` | 話題詳情頁 |
| `src/app/platform/layout.tsx` | Platform 共用 layout |
| `src/app/platform/youtube/page.tsx` | YouTube 頁 |
| `src/app/platform/lihkg/page.tsx` | LIHKG 頁 |
| `src/app/platform/news/page.tsx` | 新聞頁 |
| `src/app/platform/google-trends/page.tsx` | Google Trends 頁 |
| `src/app/api/revalidate/route.ts` | ISR revalidation webhook |
| `src/app/api/report/route.ts` | 用戶舉報 API |

*Note: Platform pages 係 18 個新建，加上修改 6 個 = 24 個文件*

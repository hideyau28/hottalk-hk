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

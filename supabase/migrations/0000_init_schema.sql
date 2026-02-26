-- ============================================
-- HotTalk HK — Database Schema v2.3
-- 12 tables + indexes + RLS
-- ============================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- 1. SCRAPE RUNS — 抓取批次記錄
-- (must be before raw_posts due to FK)
-- ============================================

CREATE TABLE scrape_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collector_name TEXT NOT NULL,       -- 'youtube_collector', 'lihkg_collector', etc.
  collector_version TEXT DEFAULT '1.0',
  platform TEXT NOT NULL,
  status TEXT NOT NULL,               -- 'success'|'partial'|'failed'|'degraded'
  status_code INTEGER,                -- HTTP status code
  posts_fetched INTEGER DEFAULT 0,
  posts_new INTEGER DEFAULT 0,        -- dedup 後新增幾多
  proxy_id TEXT,                      -- proxy hash (合規追溯)
  degradation_level TEXT DEFAULT 'L1', -- 'L1'|'L2'|'L3'
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_scrape_runs_recent ON scrape_runs(started_at DESC);

-- ============================================
-- 2. NEWS SOURCES
-- ============================================

CREATE TABLE news_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  rss_url TEXT NOT NULL,
  logo_url TEXT,
  language TEXT DEFAULT 'zh-HK',
  trust_weight FLOAT DEFAULT 1.0,     -- 用於 heat_score 計算
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0
);

-- ============================================
-- 3. RAW POSTS — 各平台抓取嘅原始數據
-- ============================================

CREATE TABLE raw_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  canonical_url TEXT,                  -- 去除 tracking params
  content_hash TEXT,                   -- SHA-256(normalized_title) 去重
  thumbnail_url TEXT,
  author_name TEXT,
  author_id TEXT,

  -- Engagement
  view_count BIGINT DEFAULT 0,
  view_count_delta_24h BIGINT DEFAULT 0, -- YouTube 24h 增量
  like_count INTEGER DEFAULT 0,
  dislike_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,

  -- AI Processing
  embedding vector(1536),
  normalized_text TEXT,                -- entity-normalized 版本
  processing_status TEXT DEFAULT 'pending', -- 'pending'|'embedded'|'assigned'|'noise'

  -- Scraping Metadata
  scrape_run_id UUID REFERENCES scrape_runs(id),
  content_policy TEXT DEFAULT 'metadata_only', -- 'metadata_only'|'full_text'
  data_quality TEXT DEFAULT 'normal',  -- 'normal'|'degraded'|'no_ai'|'seed'

  -- Timestamps
  published_at TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(platform, platform_id)
);

CREATE INDEX idx_raw_posts_processing ON raw_posts(processing_status)
  WHERE processing_status = 'pending';
CREATE INDEX idx_raw_posts_recent ON raw_posts(published_at DESC)
  WHERE published_at > NOW() - INTERVAL '48 hours';
CREATE INDEX idx_raw_posts_hash ON raw_posts(content_hash);
CREATE INDEX idx_raw_posts_platform ON raw_posts(platform, published_at DESC);

-- ============================================
-- 4. TOPICS
-- ============================================

CREATE TABLE topics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  canonical_id UUID REFERENCES topics(id), -- merge 後指向主 topic
  title TEXT NOT NULL,
  summary TEXT,
  summary_status TEXT DEFAULT 'pending', -- 'pending'|'generated'|'failed'|'hidden'

  -- Heat & Engagement
  heat_score INTEGER DEFAULT 0,        -- INTEGER 0-10000（唔係 float）
  total_engagement BIGINT DEFAULT 0,
  source_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,

  -- Sentiment
  sentiment_positive FLOAT DEFAULT 0,
  sentiment_negative FLOAT DEFAULT 0,
  sentiment_neutral FLOAT DEFAULT 0,
  sentiment_controversial FLOAT DEFAULT 0,

  -- AI Clustering
  centroid vector(1536),               -- mean(所有 assigned posts 嘅 embeddings)
  centroid_post_count INTEGER DEFAULT 0, -- 用咗幾多 posts 計算 centroid

  -- Lifecycle
  status TEXT DEFAULT 'emerging',      -- 'emerging'|'rising'|'peak'|'declining'|'archive'
  first_detected_at TIMESTAMPTZ DEFAULT NOW(),
  peak_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Safety
  flags TEXT[] DEFAULT '{}',           -- ['suspected_spam', 'sensitive', 'reported']
  report_count INTEGER DEFAULT 0,

  -- SEO
  keywords TEXT[],
  meta_description TEXT,

  -- Denormalized (fast read)
  platforms_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_topics_heat ON topics(heat_score DESC)
  WHERE status IN ('emerging', 'rising', 'peak');
CREATE INDEX idx_topics_slug ON topics(slug);
CREATE INDEX idx_topics_canonical ON topics(canonical_id);
CREATE INDEX idx_topics_status ON topics(status);

-- ============================================
-- 5. TOPIC ALIASES — SEO 301 Redirect
-- ============================================

CREATE TABLE topic_aliases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  old_slug TEXT UNIQUE NOT NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. TOPIC POSTS — 正規化 join table
-- ============================================

CREATE TABLE topic_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  post_id UUID REFERENCES raw_posts(id) ON DELETE CASCADE,
  similarity_score FLOAT,              -- cosine similarity to topic centroid
  assigned_method TEXT DEFAULT 'incremental', -- 'incremental'|'recluster'|'manual'
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(topic_id, post_id)
);

CREATE INDEX idx_topic_posts_topic ON topic_posts(topic_id);
CREATE INDEX idx_topic_posts_post ON topic_posts(post_id);

-- ============================================
-- 7. TOPIC HISTORY — 熱度時間線
-- ============================================

CREATE TABLE topic_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  heat_score INTEGER,                  -- INTEGER 同 topics table 一致
  post_count INTEGER,
  engagement BIGINT,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_topic_history_topic ON topic_history(topic_id, snapshot_at DESC);

-- ============================================
-- 8. ENTITIES — 同義詞/實體標準化
-- ============================================

CREATE TABLE entities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  canonical TEXT NOT NULL,
  aliases TEXT[] NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 9. PLATFORM DAILY STATS — Heat Score 正規化
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
-- 10. CONTENT REPORTS — 用戶舉報
-- ============================================

CREATE TABLE content_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topic_id UUID REFERENCES topics(id),
  post_id UUID REFERENCES raw_posts(id),
  reason TEXT NOT NULL,
  details TEXT,
  reporter_ip TEXT,                    -- hashed
  status TEXT DEFAULT 'pending',       -- 'pending'|'reviewed'|'actioned'|'dismissed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 11. AUDIT LOG — Topic 操作記錄
-- ============================================

CREATE TABLE audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL,           -- 'topic'|'post'|'report'
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,                -- 'merge'|'split'|'hide'|'restore'|'assign'|'manual_review'
  actor TEXT DEFAULT 'system',         -- 'system'|'admin'|'auto_report'
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- ============================================
-- 12. SENSITIVE KEYWORDS — 敏感字過濾
-- ============================================

CREATE TABLE sensitive_keywords (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  action TEXT DEFAULT 'block_summary', -- 'block_summary'|'block_topic'|'flag_only'
  is_active BOOLEAN DEFAULT TRUE
);

-- ============================================
-- RLS Policies
-- ============================================

-- Enable RLS on all tables
ALTER TABLE raw_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;

-- Public read: raw_posts, topics, topic_posts, topic_aliases, topic_history,
--              news_sources, platform_daily_stats, entities
CREATE POLICY "Public read raw_posts" ON raw_posts
  FOR SELECT USING (true);

CREATE POLICY "Public read topics" ON topics
  FOR SELECT USING (true);

CREATE POLICY "Public read topic_posts" ON topic_posts
  FOR SELECT USING (true);

CREATE POLICY "Public read topic_aliases" ON topic_aliases
  FOR SELECT USING (true);

CREATE POLICY "Public read topic_history" ON topic_history
  FOR SELECT USING (true);

CREATE POLICY "Public read news_sources" ON news_sources
  FOR SELECT USING (true);

CREATE POLICY "Public read platform_daily_stats" ON platform_daily_stats
  FOR SELECT USING (true);

CREATE POLICY "Public read entities" ON entities
  FOR SELECT USING (true);

-- content_reports: anon can INSERT (用戶舉報唔需登入), no SELECT (防濫用)
CREATE POLICY "Public insert content_reports" ON content_reports
  FOR INSERT WITH CHECK (true);

-- Service role only: audit_log, sensitive_keywords, scrape_runs
-- (service_role bypasses RLS by default, no policy needed for service writes)
-- No public access policies = effectively service_role only

-- ============================================
-- Seed Data
-- ============================================

-- News Sources (8 港媒)
INSERT INTO news_sources (name, name_en, rss_url, trust_weight, priority) VALUES
  ('HK01',     'HK01',                    'https://www.hk01.com/rss/hottest',         1.2, 1),
  ('SCMP',     'South China Morning Post', 'https://www.scmp.com/rss/91/feed',         1.5, 2),
  ('明報',     'Ming Pao',                 'https://news.mingpao.com/rss/pns/s00001.xml', 1.4, 3),
  ('東網',     'Oriental Daily',           'https://orientaldaily.on.cc/rss/news.xml',  1.0, 4),
  ('星島日報', 'Sing Tao Daily',           'https://www.singtao.ca/rss_feed/',          1.1, 5),
  ('經濟日報', 'HKET',                     'https://www.hket.com/rss/hongkong',         1.2, 6),
  ('有線新聞', 'i-Cable News',             'https://www.i-cable.com/feed/',              1.3, 7),
  ('信報',     'HKEJ',                     'https://www.hkej.com/rss/onlinenews.xml',   1.3, 8);

-- Entities (常用 HK entities)
INSERT INTO entities (canonical, aliases, category) VALUES
  ('MTR(港鐵)',    '{"港鐵","MTR","mtr","地鐵","港鐵公司"}', 'transport'),
  ('觀塘線',      '{"觀塘綫","Kwun Tong Line","KTL"}',     'transport'),
  ('深圳',        '{"Shenzhen","SZ","大陸"}',               'location'),
  ('LIHKG(連登)', '{"連登","LIHKG","lihkg","連豬"}',        'platform'),
  ('政府',        '{"特區政府","港府","HK Government","HKSAR"}', 'org');

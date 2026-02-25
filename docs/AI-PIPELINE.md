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

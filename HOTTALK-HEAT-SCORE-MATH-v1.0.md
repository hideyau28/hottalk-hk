# HotTalk HK — Heat Score 數學定義 v1.0

> 版本：v1.0 | 日期：2026-02-25
>
> 依附主文件：HOTTALK-HK-PRODUCT-SPEC-v2.3.md Section 9.6
>
> 此文件係 Heat Score 計算嘅唯一數學權威。
>
> 任何改動必須走版本控制（v1.1, v1.2…），唔可以只改 spec 唔改呢度。

-----

## 1. Raw Engagement 口徑定義（唯一，不可有第二種算法）

|平台 |公式 |說明 |
|-----------------|---------------------------------------------------|----------------------------------------------------------|
|**YouTube** |`sum(view_count_delta_24h)` |24h 增量，避免舊片永久佔優。需 raw_posts.view_count_delta_24h 欄位。 |
|**LIHKG** |`sum((like_count - dislike_count) + comment_count)`|淨 like + 回覆數。反映真實討論熱度。 |
|**News** |`sum(source_trust_weight)` |按 news_sources.trust_weight 加總。權威媒體權重更高。 |
|**Google Trends**|`max(traffic_volume)` |取最高流量值。stored as raw_posts.view_count for trends platform.|

### 口徑一致性規則

platform_daily_stats 嘅 p50/p75/p90/p95/p99 必須用以上同一條公式計算。

heat_score 嘅 percentile_rank_7d() 必須 query platform_daily_stats 取得分位。

三者口徑必須完全一致，否則 percentile 無意義。

-----

## 2. Percentile Rank 計算

### 2.1 platform_daily_stats 每日快照（Cron 04:00 HKT）

-- 每日為每個平台計算 engagement 分位

INSERT INTO platform_daily_stats (platform, date, p50, p75, p90, p95, p99, total_posts)
SELECT
  platform,
  CURRENT_DATE,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY raw_engagement),
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY raw_engagement),
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY raw_engagement),
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY raw_engagement),
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY raw_engagement),
  COUNT(*)
FROM (
  -- 用同一條 raw_engagement 公式
  SELECT
    platform,
    CASE platform
      WHEN 'youtube' THEN view_count_delta_24h
      WHEN 'lihkg' THEN (like_count - dislike_count) + comment_count
      WHEN 'news' THEN (SELECT trust_weight FROM news_sources ns WHERE ns.name = raw_posts.author_name)
      WHEN 'google_trends' THEN view_count
    END AS raw_engagement
  FROM raw_posts
  WHERE published_at > NOW() - INTERVAL '24 hours'
    AND data_quality != 'seed' -- v2.3: 排除 seed
    AND published_at > NOW() - INTERVAL '48 hours' -- v2.3: 48h 硬限制
) sub
GROUP BY platform;

### 2.2 percentile_rank_7d()

```py
def percentile_rank_7d(platform: str, value: float) -> float:
    """返回 0.0 - 1.0 基於最近 7 日嘅 platform_daily_stats rolling distribution"""

    stats = query(
        """
        SELECT
          AVG(p50) as p50,
          AVG(p75) as p75,
          AVG(p90) as p90,
          AVG(p95) as p95,
          AVG(p99) as p99
        FROM platform_daily_stats
        WHERE platform = %s
          AND date > CURRENT_DATE - 7
          AND data_quality != 'seed'
        """,
        platform,
    )

    if value <= stats.p50:
        return value / stats.p50 * 0.50

    if value <= stats.p75:
        return 0.50 + (value - stats.p50) / (stats.p75 - stats.p50) * 0.25

    if value <= stats.p90:
        return 0.75 + (value - stats.p75) / (stats.p90 - stats.p75) * 0.15

    if value <= stats.p95:
        return 0.90 + (value - stats.p90) / (stats.p95 - stats.p90) * 0.05

    if value <= stats.p99:
        return 0.95 + (value - stats.p95) / (stats.p99 - stats.p95) * 0.04

    return min(1.0, 0.99 + (value - stats.p99) / stats.p99 * 0.01)  # cap at 1.0
```

### 2.3 Bootstrap + 平滑過渡

Day 1-7: 100% simple_rank（當日 posts 內排序 / total）

Day 8: 50% simple + 50% percentile

Day 9: 25% simple + 75% percentile

Day 10+: 100% percentile

公式:

blend = min(1.0, (days_since_launch - 7) / 3)

final = (1 - blend) * simple_rank + blend * percentile_rank

-----

## 3. Heat Score 合成公式

heat_score = int(round(raw_composite * 10000)) # INTEGER 0-10000

### 3.1 Component Weights

|Component |Weight|計算方法 |
|--------------------|------|--------------------------------------|
|**engagement** |0.30 |mean(各平台 percentile_rank) |
|**source_diversity**|0.25 |min(active_platforms / 4.0, 1.0) |
|**velocity** |0.25 |min(1.0, posts_1h / 3.0) |
|**trends_signal** |0.10 |google_trends percentile (若有) |
|**recency** |0.10 |e^(-0.05 × hours_since_first_detected)|

### 3.2 平台缺失時權重 Re-normalize

# 若某平台 6h 無新數據 → 移除相關權重項 → 重新 normalize

# 例子：LIHKG + Google Trends 都掛咗

active_weights = {
  'engagement': 0.30, # 只剩 YouTube + News
  'source_diversity': 0.25,
  'velocity': 0.25,
  # 'trends_signal' 移除
  'recency': 0.10,
}

total = sum(active_weights.values()) # = 0.90

normalized = {k: v/total for k, v in active_weights.items()}

# engagement: 0.333, source_diversity: 0.278, velocity: 0.278, recency: 0.111

-----

## 4. Velocity 定義

```py
def calculate_velocity(topic: Topic) -> float:
    """MVP 穩定版（Option B）:

    velocity = min(1.0, posts_in_last_1h / 3)

    1h 內 0 posts → 0.0
    1h 內 1 post → 0.33
    1h 內 2 posts → 0.67
    1h 內 3+ posts → 1.0 (cap)

    避免小樣本假高問題。
    """

    posts_1h = count_posts_since(topic, hours=1)
    return min(1.0, posts_1h / 3.0)
```

-----

## 5. 跨時間事件保護

# 防止「港鐵故障」2 月嘅 topic 被 8 月嘅新故障錯誤合併

```py
def should_force_new_topic(existing_topic: Topic) -> bool:
    """即使 cosine similarity 達標，以下條件仍強制新建 topic"""

    return (
        hours_since(existing_topic.last_updated_at) > 72
        and days_since(existing_topic.first_detected_at) > 7
    )
```

-----

## 6. Topic Status 自動轉換（觸發 heat_score 更新後執行）

|當前 Status|→ 新 Status |條件 |
|---------|-----------|-----------------------------------|
|emerging |→ rising |post_count ≥ 5 AND source_count ≥ 2|
|emerging |→ archive |alive > 6h AND post_count < 3 |
|rising |→ peak |heat_score ≥ p90 of today’s topics |
|rising |→ declining|velocity < 0.2 |
|peak |→ declining|velocity < 0.5 OR heat_score < p70 |
|declining|→ archive |72h 無新 post |

-----

## 7. Nightly Recluster SEO 穩定閘

|Topic Age|允許操作 |
|---------|--------------------------------------|
|< 24h |merge ✅ split ✅ |
|24h - 48h|merge ✅ split ⚠️（需人工確認） |
|> 48h |merge ✅ split ❌（只允許 merge + 301 alias）|

-----

## 8. 查詢硬限制

-- 所有 vector scan / percentile / assign query 必須加:

WHERE published_at > NOW() - INTERVAL '48 hours'

-- 無例外。唔加就係 bug。

-- 這條 WHERE 確保 query 掃描量永遠 bounded。

-----

## 版本歷史

|版本 |日期 |變更 |
|----|----------|------------|
|v1.0|2026-02-25|初版。鎖死所有數學定義。|

# Sprint 2: AI Pipeline — 實施計劃

## 依賴圖

```
Task 1 (Entity Normalize)
  └─▶ Task 2 (Embedding) — 需要 normalized_text
        └─▶ Task 3 (Incremental Assign) — 需要 embedding vectors
              ├─▶ Task 4 (Summarize) — 新/更新 topic 觸發
              ├─▶ Task 5 (Heat Score) — assign 後計算
              │     └─▶ Task 7 (Status Transition) — heat_score 更新後執行
              └─▶ Task 6 (Nightly Recluster) — 獨立 cron，但用到 Task 5 邏輯
Task 8 (FastAPI endpoints) — 整合所有 jobs
```

---

## Task 1: Entity Normalization

**檔案**: `worker/utils/entity_normalize.py` (新建)

**依賴**: `worker/utils/supabase_client.py` (已有)

**步驟**:

1. 從 Supabase `entities` table 讀取所有 canonical + aliases pairs
2. 建立一個 alias→canonical 嘅 lookup dict（啟動時 cache，唔使每次 query）
3. `normalize_text(text: str) -> str` 函數：掃描 text，將所有命中嘅 alias 替換為 canonical
   - 用 longest-match-first 策略（避免「港鐵公司」被截斷成「港鐵」先命中）
   - aliases 按長度降序排列後 build regex pattern
   - 大小寫不敏感 match
4. `build_normalized_text(title: str, description: str | None) -> str` — 組合 title + description 前 200 chars，entity normalize 後回傳
5. `refresh_entity_cache()` — 重新載入 entities（可被 admin 觸發）
6. 所有替換只影響 normalized_text column，原文 title/description 保持不變

---

## Task 2: OpenAI Embedding (Batch)

**檔案**: `worker/utils/embedding.py` (新建)

**依賴**: `openai` Python SDK, Task 1 (entity_normalize)

**新增 requirements**: `openai>=1.12.0`

**步驟**:

1. `batch_embed_pending_posts()` — 主入口：
   - Query raw_posts WHERE processing_status = 'pending' AND published_at > NOW() - 48h
   - 對每個 post 呼叫 `build_normalized_text(title, description)` 得到 normalized_text
   - 收集所有 normalized_text → 一次 batch call OpenAI `text-embedding-3-small` (1536 dim)
   - OpenAI batch 最多 2048 texts/call，超過則分批
   - 寫回 raw_posts: embedding = vector, normalized_text = text, processing_status = 'embedded'
2. Error handling:
   - Batch 失敗 → fallback 逐個 embed
   - 全部失敗 → 標記 data_quality = 'no_ai', processing_status = 'noise'
   - OpenAI API timeout: 30s
   - Rate limit: exponential backoff (1s, 2s, 4s) 最多 3 次 retry
3. 回傳 `{"embedded": N, "failed": M, "skipped": K}` 統計

---

## Task 3: Incremental Topic Assignment (每 10 分鐘)

**檔案**: `worker/jobs/incremental_assign.py` (新建)

**依賴**: Task 1 (entity_normalize), Task 2 (embedding), Task 5 (heat_score), Task 7 (status transition)

**步驟**:

1. `run_incremental_assign()` — 主入口，完整流程：
   - Step 1: 呼叫 `batch_embed_pending_posts()` embed 所有 pending posts
   - Step 2: 拉取所有新 embedded posts (processing_status = 'embedded', published_at > NOW() - 48h)
   - Step 3: 拉取 top 300 active topics：
     ```sql
     WHERE status IN ('emerging','rising','peak')
     AND last_updated_at > NOW() - INTERVAL '24 hours'
     ORDER BY heat_score DESC LIMIT 300
     ```
   - Step 4: 對每個 embedded post，計算同所有 300 topic centroids 嘅 cosine similarity
   - Step 5: 最高 similarity > 0.80 → 檢查跨時間事件保護：
     - `topic.last_updated_at > 72h AND topic.first_detected_at > 7d` → 強制新建，唔 assign
     - 否則 → assign 到該 topic → 插入 topic_posts (similarity_score, method='incremental')
   - Step 6: Centroid 增量更新：
     - `new_centroid = (old_centroid * n + new_embedding) / (n + 1)`
     - `centroid_post_count += 1`
     - 每 20 posts (centroid_post_count % 20 == 0): full recompute `centroid = mean(ALL topic_posts embeddings)`
   - Step 7: 收集所有 unassigned posts，互相計算 cosine similarity
     - 用 greedy clustering：sim > 0.80 嘅 posts 歸同一 cluster
   - Step 8: 新 cluster 檢查：
     - `len(cluster) >= 3 AND len(unique_platforms) >= 2` → 創建新 topic
     - 例外：news + google_trends 同時出現 → 即使只有 2 posts → 創建 emerging topic
     - 新 topic: slug = 'temp-{uuid[:8]}' (等 summarize 產生正式 slug)
     - centroid = mean(cluster embeddings)
     - 仍未達標嘅 posts → 保持 processing_status = 'embedded'（下次再嘗試）
   - Step 9: 更新所有受影響 topic 嘅 heat_score (呼叫 Task 5)
   - Step 10: 更新所有受影響 topic 嘅 status (呼叫 Task 7)
   - Step 11: 觸發 summarize — 新 topic 或 existing topic 新增 ≥5 posts (呼叫 Task 4)
   - Step 12: assigned posts → processing_status = 'assigned'
   - Step 13: 更新 topic metadata (post_count, source_count, platforms_json, last_updated_at)

2. 回傳統計: `{"posts_processed": N, "assigned_existing": M, "new_topics": K, "unassigned": J}`

---

## Task 4: Claude Haiku Summarization

**檔案**: `worker/jobs/summarize.py` (新建)

**依賴**: `anthropic` Python SDK, `worker/utils/sensitive_filter.py` (新建)

**新增 requirements**: `anthropic>=0.49.0`

**子任務 4a: Sensitive Filter** (`worker/utils/sensitive_filter.py`)

1. 從 `sensitive_keywords` table 讀取 active keywords + action
2. `check_sensitive(text: str) -> SensitiveResult` — 回傳 is_sensitive, action, matched_keywords
3. Cache keywords，唔使每次 query DB

**子任務 4b: Summarize Job** (`worker/jobs/summarize.py`)

1. `summarize_topics(topic_ids: list[str])` — 主入口：
   - 對每個 topic_id：拉取所有 topic_posts → raw_posts 嘅 title + description
   - 敏感字檢查：如果命中 'block_summary' → summary_status = 'hidden', skip
   - 如果命中 'flag_only' → flags += ['sensitive'], 繼續
2. Token cap 檢查：
   - 用 Redis key `hottalk:llm_tokens:{date}` 追蹤當日用量
   - 超過 500K → 停止摘要，summary_status = 'pending'
3. Claude Haiku prompt (按 spec 9.5 嘅 template)：
   - 輸入：cluster posts titles + snippets
   - 輸出：JSON `{title, summary, sentiment, keywords, slug_suggestion}`
4. Validation:
   - Parse JSON → 失敗 → retry 1 次 → 仍失敗 → 用第一個 post 嘅 title 作為 topic title
   - sentiment 四個值 sum != 1.0 → normalize
   - slug 撞到 (check topics table) → append `-{hash[:4]}`
   - keywords 空 → fallback 詞頻 top 3（掃所有 cluster posts 嘅 title + description）
5. 寫回 topics: title, summary, sentiment_*, keywords, slug, summary_status = 'generated'
6. 回傳統計: `{"summarized": N, "failed": M, "skipped_sensitive": K, "skipped_cap": J}`

---

## Task 5: Heat Score Calculation

**檔案**: `worker/utils/heat_score.py` (新建)

**依賴**: `worker/utils/supabase_client.py`

**嚴格跟 HOTTALK-HEAT-SCORE-MATH-v1.0.md**

**步驟**:

1. `get_raw_engagement(platform: str, posts: list[Post]) -> float` — 每個平台嘅 raw engagement 公式：
   - youtube: `sum(view_count_delta_24h)`
   - lihkg: `sum((like_count - dislike_count) + comment_count)`
   - news: `sum(trust_weight)` — query news_sources.trust_weight by author_name
   - google_trends: `max(view_count)`

2. `percentile_rank_7d(platform: str, value: float) -> float` — 0.0 ~ 1.0：
   - Query `platform_daily_stats` 最近 7 日 AVG(p50/p75/p90/p95/p99)
   - 排除 `data_quality != 'seed'`
   - 線性插值 (按 Math doc Section 2.2)

3. Bootstrap + 平滑過渡：
   - Day 1-7: 100% `simple_rank_today()`（同日 posts 排序 / total）
   - Day 8-10: blend = `min(1.0, (days - 7) / 3.0)`
   - Day 11+: 100% percentile

4. `calculate_heat_score(topic_id: str) -> int` — 主入口：
   - 拉取 topic 嘅所有 posts (topic_posts JOIN raw_posts, WHERE published_at > NOW() - 48h)
   - Per-platform percentile scoring
   - Component weights: engagement=0.30, source_diversity=0.25, velocity=0.25, trends_signal=0.10, recency=0.10
   - 平台缺失 → 移除 trends_signal → re-normalize weights
   - velocity = `min(1.0, posts_1h / 3.0)`
   - recency = `exp(-0.05 * hours_since_first_detected)`
   - `heat_score = int(round(raw_composite * 10000))` — INTEGER 0-10000
   - 寫回 topics.heat_score
   - 插入 topic_history snapshot

5. `update_platform_daily_stats()` — 每日 04:00 HKT 跑一次：
   - 按 Math doc Section 2.1 計算 p50/p75/p90/p95/p99
   - 排除 `data_quality != 'seed'`
   - 強制 `published_at > NOW() - 48h`

---

## Task 6: Nightly Recluster (每日 02:00)

**檔案**: `worker/jobs/nightly_recluster.py` (新建)

**依賴**: `hdbscan`, `numpy`, Task 5 (heat_score), Task 4 (summarize)

**新增 requirements**: `hdbscan>=0.8.38`, `numpy>=1.26.0`, `scikit-learn>=1.4.0`

**步驟**:

1. `run_nightly_recluster()` — 主入口：
   - Step 1: 拉取近 48h 所有 posts + embeddings (WHERE published_at > NOW() - 48h AND embedding IS NOT NULL)
   - Step 2: 轉換 embeddings 為 numpy array
   - Step 3: HDBSCAN clustering (min_cluster_size=3, min_samples=2, metric='euclidean')
     - 用 precomputed cosine distance matrix 或直接 euclidean on normalized vectors
   - Step 4: Topic Reconciliation — 比對 HDBSCAN clusters vs 現有 topics：
     - 計算每個 cluster 同現有 topic centroid 嘅 overlap (Jaccard on post sets + cosine on centroids)
     - High overlap (>70% posts shared) → 保留現有 topic (slug 不變)
     - 兩個現有 topics 合併 → merge：
       - 保留 heat_score 較高嘅作為 canonical
       - 另一個設 canonical_id → canonical topic
       - 舊 slug 入 topic_aliases
       - audit_log 記錄
     - 一個 topic 應拆分 → 檢查 SEO 穩定閘：
       - topic_age < 24h → 允許 split
       - 24h < topic_age < 48h → 標記需人工確認 (flags += ['needs_review'])
       - topic_age > 48h → 禁止 split，只允許 merge + 301 alias
     - 新 cluster 唔匹配任何現有 topic → 創建新 topic (如果 ≥3 posts + ≥2 platforms)
   - Step 5: 更新所有 topic centroids (full recompute)
   - Step 6: 更新所有 topic 嘅 heat_score (呼叫 Task 5)
   - Step 7: 新/更新 topic → 觸發 summarize (呼叫 Task 4)
   - Step 8: 生成 quality metrics：
     - cluster_count, merge_count, split_count, noise_count
     - avg_cluster_purity, avg_intra_cluster_similarity
   - Step 9: audit_log 記錄所有 merge/split 操作

2. 回傳統計 dict

---

## Task 7: Topic Status Auto-transition

**檔案**: `worker/utils/topic_status.py` (新建)

**依賴**: Task 5 (heat_score 嘅 velocity 計算)

**步驟**:

1. `update_topic_status(topic_id: str) -> str` — 每次 heat_score 更新後呼叫：
   - 讀取 topic 嘅 current status, post_count, source_count, heat_score, first_detected_at, last_updated_at
   - 計算 velocity = `min(1.0, posts_1h / 3.0)`
   - 轉換規則（嚴格跟 Math doc Section 6）：
     - emerging → rising: post_count ≥ 5 AND source_count ≥ 2
     - emerging → archive: alive > 6h AND post_count < 3
     - rising → peak: heat_score ≥ p90 of today's active topics
     - rising → declining: velocity < 0.2
     - peak → declining: velocity < 0.5 OR heat_score < p70 of today's active topics
     - declining → archive: 72h 無新 post (last_updated_at > 72h)
   - 寫回 topics.status
   - 如果轉為 peak → 同時寫 topics.peak_at = NOW()
   - audit_log 記錄 status change

---

## Task 8: FastAPI Endpoints

**檔案**: `worker/main.py` (修改現有)

**依賴**: 所有上面嘅 tasks

**步驟**:

1. 新增 endpoints：
   - `POST /jobs/incremental-assign` — QStash 每 10 分鐘觸發
     - verify QStash signature
     - 呼叫 `run_incremental_assign()`
     - 回傳 result summary
   - `POST /jobs/nightly-recluster` — QStash 每日 02:00 觸發
     - verify QStash signature
     - 呼叫 `run_nightly_recluster()`
     - 回傳 result summary
   - `POST /jobs/update-daily-stats` — QStash 每日 04:00 觸發
     - verify QStash signature
     - 呼叫 `update_platform_daily_stats()`
   - `GET /health` — 已有，增加 DB connectivity check
2. Error handling: 所有 endpoint 加 try-catch，失敗回傳 500 + error detail
3. 更新 `requirements.txt` 加入新依賴：`openai`, `anthropic`, `hdbscan`, `numpy`, `scikit-learn`

---

## 新建檔案清單

| # | 路徑 | 描述 |
|---|------|------|
| 1 | `worker/utils/entity_normalize.py` | Entity normalization |
| 2 | `worker/utils/embedding.py` | OpenAI batch embedding |
| 3 | `worker/utils/heat_score.py` | Heat Score 計算 |
| 4 | `worker/utils/sensitive_filter.py` | 敏感字過濾 |
| 5 | `worker/utils/topic_status.py` | Topic status auto-transition |
| 6 | `worker/jobs/incremental_assign.py` | 每 10 分鐘增量聚類 |
| 7 | `worker/jobs/summarize.py` | Claude Haiku 摘要生成 |
| 8 | `worker/jobs/nightly_recluster.py` | 每日 02:00 HDBSCAN |

## 修改檔案清單

| # | 路徑 | 變更 |
|---|------|------|
| 1 | `worker/main.py` | 新增 3 個 POST endpoints |
| 2 | `worker/requirements.txt` | 新增 openai, anthropic, hdbscan, numpy, scikit-learn |

---

## 實施順序（建議每個 task commit 一次）

1. **Commit 1**: Task 1 — entity_normalize.py
2. **Commit 2**: Task 2 — embedding.py + requirements.txt (openai)
3. **Commit 3**: Task 5 — heat_score.py (Task 3 需要用到)
4. **Commit 4**: Task 7 — topic_status.py (Task 3 需要用到)
5. **Commit 5**: Task 4a — sensitive_filter.py
6. **Commit 6**: Task 4b — summarize.py + requirements.txt (anthropic)
7. **Commit 7**: Task 3 — incremental_assign.py (整合 T1+T2+T5+T7+T4)
8. **Commit 8**: Task 6 — nightly_recluster.py + requirements.txt (hdbscan, numpy, scikit-learn)
9. **Commit 9**: Task 8 — main.py endpoints 整合
10. **Commit 10**: Push to branch

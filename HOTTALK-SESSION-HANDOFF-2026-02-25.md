# HotTalk HK — Session Handoff

> 日期：2026-02-25
>
> 狀態：Spec v2.3 FINAL — 5 輪 AI Review 完成，準備開始 coding

## 📋 文件清單

|文件 |狀態 |用途 |
|---------------------------------------|-------|---------------------|
|`HOTTALK-HK-PRODUCT-SPEC-v2.3.md` |✅ FINAL|完整產品規格書 |
|`HOTTALK-HEAT-SCORE-MATH-v1.0.md` |✅ FINAL|Heat Score 數學定義（唯一權威）|
|`HOTTALK-SESSION-HANDOFF-2026-02-25.md`|✅ 本文件 |新 session 入口 |

## 🔑 關鍵決策記錄

1. AI Pipeline: Railway Python Worker + 增量 assign (top 300) + 夜間 HDBSCAN
1. Heat Score: INTEGER 0-10000 + per-platform percentile + 口徑鎖死（見 Math 文件）
1. Topic 穩定性: centroid (每 20 posts recompute) + 跨時間事件保護 (72h+7d)
1. SEO 保護: slug 不含日期 + >48h 禁 split + topic_aliases 301
1. MVP Scope: 熱話牆 + Topic Page + Admin Review only
1. Sprint: 6 週 + Launch 前 7 日 seed 數據
1. 降級: LIHKG 3 層 + AI fallback + 平台缺失權重 re-normalize

## 🏗️ 技術棧

Frontend: Next.js 14 (ISR + On-demand) + Tailwind + shadcn/ui → Vercel

Database: Supabase (PostgreSQL + pgvector + Edge Functions + Auth)

Cache: Upstash Redis + QStash (scheduler)

AI Worker: Railway (Python 3.11 FastAPI, always-on ~$5/月)

AI APIs: Claude Haiku (summary) + OpenAI text-embedding-3-small

## ⚠️ v2.3 新增注意事項

- heat_score 係 **INTEGER**（唔係 float）
- 所有 vector query 強制加 48h WHERE
- Seed data 標記 `data_quality='seed'`，排除 percentile 計算
- velocity = `min(1.0, posts_1h / 3)`（唔好用舊嘅 1h/6h ratio）
- raw_posts 新增 `view_count_delta_24h`（YouTube 24h 增量）
- Nightly recluster: topic > 48h 禁止 split
- keywords 空時用詞頻 top 3 fallback

## 📊 5 輪 Review 總結

|#|Reviewer |發現 |版本 |
|-|-----------------------|-------------------------|------|
|1|GPT-4o (Round 1) |5 Critical + 4 Major |→ v2.0|
|2|Gemini 2.5 Pro |5 Critical + 4 Major |→ v2.0|
|3|Claude (Self-Review) |6 Minor |→ v2.1|
|4|GPT-4o (Pressure Test) |5 High Risk + 3 Minor |→ v2.2|
|5|GPT-4o (Math Precision)|10 Math/Engineering fixes|→ v2.3|

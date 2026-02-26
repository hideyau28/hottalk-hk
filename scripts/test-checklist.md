# HotTalk HK — Pre-launch Test Checklist

## 首頁 & 基本功能
- [ ] 首頁載入 < 3 秒
- [ ] 首頁顯示 >= 10 topics（或 fallback 邏輯生效）
- [ ] 0 topics 時顯示「熱話即將上線」fallback
- [ ] Platform tabs 正常切換（全部 / YouTube / 連登 / 新聞 / Google）
- [ ] Topic card 顯示正確（標題、heat score、平台 badge、AI 摘要、情緒條）
- [ ] 「更新於 X 分鐘前」時間顯示正確
- [ ] Ad slot 每 4 個 topic 後顯示

## Topic 詳情頁
- [ ] Topic page SEO meta 正確（title, description, OG tags）
- [ ] JSON-LD structured data 正確（Article + BreadcrumbList）
- [ ] AI 摘要正常顯示
- [ ] 情緒分析 bar 正常顯示
- [ ] 相關文章按平台分組
- [ ] 相關文章連結可正常打開（target="_blank"）
- [ ] Report button 功能正常

## SEO
- [ ] sitemap.xml 可訪問（/sitemap.xml）
- [ ] sitemap 包含靜態頁面 + 平台頁面 + 動態 topics
- [ ] robots.txt 正確（/robots.txt）
- [ ] robots.txt block GPTBot 同 CCBot
- [ ] robots.txt disallow /admin/ 同 /api/
- [ ] OG image 生成正常（/api/og?topic=xxx）
- [ ] OG image fallback 正常（/api/og 無 topic param）
- [ ] topic_aliases 301/308 redirect 正常
- [ ] canonical URL 設定正確

## Legal Pages
- [ ] /privacy 可訪問，內容完整
- [ ] /terms 可訪問，內容完整
- [ ] /about 可訪問，內容完整
- [ ] /report 可訪問，內容完整
- [ ] Footer 連結正常（關於我們 / 私隱政策 / 使用條款 / 舉報指引）

## Error Pages
- [ ] 404 page 正常顯示（訪問不存在嘅 URL）
- [ ] 404 page 有返回首頁按鈕
- [ ] 500 error page 正常顯示
- [ ] Loading skeleton 正常顯示

## Admin
- [ ] Admin pages 需要 auth（未登入 redirect 到 /admin/login）
- [ ] Admin topic-review 正常運作
- [ ] Admin status dashboard 正常運作

## Report 功能
- [ ] Report button 彈出選項
- [ ] 提交 report 成功
- [ ] Rate limit 生效（5 次/60 秒）
- [ ] 被舉報 >= 3 次 → AI 摘要自動隱藏
- [ ] 被舉報 >= 5 次 → 話題自動下架

## Mobile Responsive
- [ ] iOS Safari 顯示正常
- [ ] Android Chrome 顯示正常
- [ ] Header sticky 正常
- [ ] Platform tabs 可滾動（小螢幕）
- [ ] Topic card 排版正常
- [ ] Legal pages 文字可讀

## Performance
- [ ] Lighthouse Performance score > 90
- [ ] Lighthouse Accessibility score > 90
- [ ] Lighthouse SEO score > 90
- [ ] ISR revalidation 正常（5 分鐘更新）
- [ ] Server Components 無不必要嘅 'use client'

## 冷啟動
- [ ] Seed script 可正常運行（npm run seed）
- [ ] Seed topics 標記 data_quality='seed'
- [ ] 首頁 fallback 邏輯正常（< 10 topics 時放寬條件）

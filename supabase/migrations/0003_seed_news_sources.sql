-- Seed Hong Kong news sources for RSS collection
-- Each source has a trust_weight (higher = more authoritative for heat score)

INSERT INTO news_sources (name, name_en, rss_url, trust_weight, priority, language) VALUES
  -- 主流中文媒體
  ('明報',        'Ming Pao',    'https://news.mingpao.com/rss/pns/s00001.xml',           1.2, 10, 'zh-HK'),
  ('星島日報',     'Sing Tao',    'https://std.stheadline.com/rss/RealTimeNews/HK.xml',    1.0,  8, 'zh-HK'),
  ('香港01',      'HK01',        'https://web.hk01.com/rss/hotTopics.xml',                1.1, 10, 'zh-HK'),
  ('經濟日報',     'HKET',        'https://www.hket.com/rss/hongkong',                     1.0,  7, 'zh-HK'),
  ('東方日報',     'Oriental Daily','https://orientaldaily.on.cc/rss/news.xml',             0.9,  6, 'zh-HK'),
  ('頭條日報',     'Headline Daily','https://hd.stheadline.com/rss/news/daily.xml',         0.9,  6, 'zh-HK'),

  -- 英文媒體
  ('南華早報',     'SCMP',        'https://www.scmp.com/rss/91/feed',                      1.3, 10, 'en'),
  ('Hong Kong Free Press', 'HKFP','https://hongkongfp.com/feed/',                         1.1,  8, 'en'),

  -- 官方 / 公營媒體
  ('香港電台',     'RTHK',        'https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml',1.2,  9, 'zh-HK'),
  ('香港電台英文', 'RTHK English','https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml',1.2,  9, 'en'),

  -- 財經
  ('信報',        'HKEJ',        'https://www.hkej.com/rss/onlinenews.xml',               1.0,  7, 'zh-HK'),
  ('阿思達克',    'AAStocks',    'https://www.aastocks.com/tc/resources/datafeed/rss/hot-news/aafn-hot-news-zh.xml', 0.8, 5, 'zh-HK')

ON CONFLICT DO NOTHING;

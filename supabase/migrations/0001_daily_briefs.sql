-- Daily Briefs table for v3.2 daily summary feature
CREATE TABLE daily_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_date DATE NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
    content JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (brief_date, tier)
);

ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read daily_briefs"
    ON daily_briefs FOR SELECT
    USING (true);

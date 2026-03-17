-- Resize embedding vectors from 1536 (OpenAI) to 768 (Gemini text-embedding-004)
-- ⚠️ Existing embeddings will be invalidated — must re-embed all raw_posts after migration.

ALTER TABLE raw_posts ALTER COLUMN embedding TYPE vector(768);
ALTER TABLE topics ALTER COLUMN centroid TYPE vector(768);

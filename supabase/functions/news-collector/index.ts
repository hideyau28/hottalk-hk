import { getServiceClient } from "../_shared/supabase-client.ts";
import { verifyQStashSignature } from "../_shared/qstash-verify.ts";
import {
  contentHash,
  stripTrackingParams,
  errorResponse,
  jsonResponse,
} from "../_shared/utils.ts";

const TIMEOUT_MS = 120_000;
const PER_FEED_TIMEOUT_MS = 15_000;

interface NewsSource {
  id: string;
  name: string;
  rss_url: string;
  trust_weight: number;
}

interface ParsedItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  imageUrl: string | null;
}

Deno.serve(async (req: Request) => {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return errorResponse("Unauthorized", 401);
  }

  const startTime = Date.now();
  const supabase = getServiceClient();

  // Create scrape_run
  const { data: scrapeRun, error: scrapeErr } = await supabase
    .from("scrape_runs")
    .insert({
      collector_name: "news_collector",
      platform: "news",
      status: "running",
    })
    .select("id")
    .single();

  if (scrapeErr || !scrapeRun) {
    return errorResponse(`Failed to create scrape_run: ${scrapeErr?.message}`);
  }
  const runId = scrapeRun.id;

  try {
    // Fetch active news sources from DB
    const { data: sources, error: srcErr } = await supabase
      .from("news_sources")
      .select("id, name, rss_url, trust_weight")
      .eq("is_active", true);

    if (srcErr || !sources || sources.length === 0) {
      await finalizeScrapeRun(supabase, runId, startTime, {
        status: "failed",
        error_message: `No active news sources: ${srcErr?.message}`,
      });
      return errorResponse("No active news sources");
    }

    // AbortController for overall timeout
    const controller = new AbortController();
    const globalTimeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Fetch all RSS feeds concurrently
    const feedResults = await Promise.allSettled(
      sources.map((src) => fetchAndParseFeed(src, controller.signal))
    );
    clearTimeout(globalTimeout);

    // Collect all parsed items
    const allRows: Record<string, unknown>[] = [];
    let failedSources = 0;

    for (let i = 0; i < feedResults.length; i++) {
      const result = feedResults[i];
      const source = sources[i];

      if (result.status === "rejected") {
        failedSources++;
        continue;
      }

      const items = result.value;
      const rows = await Promise.all(
        items.map(async (item) => {
          const canonical = stripTrackingParams(item.link);
          const hash = await contentHash(item.title);
          const platformId = await contentHash(canonical);

          return {
            platform: "news",
            platform_id: `news_${platformId}`,
            title: item.title,
            description: (item.description ?? "").slice(0, 500),
            url: item.link,
            canonical_url: canonical,
            thumbnail_url: item.imageUrl,
            author_name: source.name,
            content_hash: hash,
            scrape_run_id: runId,
            processing_status: "pending",
            content_policy: "metadata_only",
            data_quality: "normal",
            published_at: parseDate(item.pubDate),
            collected_at: new Date().toISOString(),
          };
        })
      );
      allRows.push(...rows);
    }

    if (allRows.length === 0) {
      await finalizeScrapeRun(supabase, runId, startTime, {
        status: failedSources === sources.length ? "failed" : "partial",
        posts_fetched: 0,
        posts_new: 0,
        error_message: `All feeds empty or failed. Failed sources: ${failedSources}/${sources.length}`,
      });
      return jsonResponse({ collector: "news_collector", posts_fetched: 0, posts_new: 0 });
    }

    // Batch upsert (chunked to avoid payload limits)
    let totalNew = 0;
    const CHUNK_SIZE = 100;
    for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
      const chunk = allRows.slice(i, i + CHUNK_SIZE);
      const { data: upserted, error: upsertErr } = await supabase
        .from("raw_posts")
        .upsert(chunk, {
          onConflict: "platform,platform_id",
          ignoreDuplicates: true,
        })
        .select("id");

      if (upsertErr) {
        console.error(`Upsert chunk error: ${upsertErr.message}`);
        continue;
      }
      totalNew += upserted?.length ?? 0;
    }

    const status = failedSources > 0 ? "partial" : "success";
    await finalizeScrapeRun(supabase, runId, startTime, {
      status,
      status_code: 200,
      posts_fetched: allRows.length,
      posts_new: totalNew,
      error_message: failedSources > 0
        ? `${failedSources}/${sources.length} sources failed`
        : null,
    });

    return jsonResponse({
      collector: "news_collector",
      posts_fetched: allRows.length,
      posts_new: totalNew,
      failed_sources: failedSources,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeScrapeRun(supabase, runId, startTime, {
      status: "failed",
      error_message: message.slice(0, 1000),
    });
    return errorResponse(message);
  }
});

async function fetchAndParseFeed(
  source: NewsSource,
  signal: AbortSignal
): Promise<ParsedItem[]> {
  const feedController = new AbortController();
  const feedTimeout = setTimeout(() => feedController.abort(), PER_FEED_TIMEOUT_MS);

  // Abort if parent signal fires
  const onAbort = () => feedController.abort();
  signal.addEventListener("abort", onAbort);

  try {
    const resp = await fetch(source.rss_url, { signal: feedController.signal });
    clearTimeout(feedTimeout);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} for ${source.name}`);
    }

    const xml = await resp.text();
    return parseRssXml(xml);
  } finally {
    clearTimeout(feedTimeout);
    signal.removeEventListener("abort", onAbort);
  }
}

function parseRssXml(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  // Extract <item> blocks
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = extractCdata(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const description = extractCdata(block, "description");

    // Image: try <media:content>, <enclosure>, <media:thumbnail>
    const imageUrl =
      extractAttr(block, "media:content", "url") ??
      extractAttr(block, "enclosure", "url") ??
      extractAttr(block, "media:thumbnail", "url") ??
      null;

    if (title && link) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        pubDate: pubDate ?? new Date().toISOString(),
        description: stripHtml(description ?? "").slice(0, 500),
        imageUrl,
      });
    }
  }

  return items;
}

function extractCdata(block: string, tag: string): string | null {
  // Try CDATA first
  const cdataRe = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = cdataRe.exec(block);
  if (cdataMatch) return cdataMatch[1];

  // Fallback to plain tag
  return extractTag(block, tag);
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function extractAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const m = re.exec(block);
  return m ? m[1] : null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
}

function parseDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

async function finalizeScrapeRun(
  supabase: ReturnType<typeof getServiceClient>,
  runId: string,
  startTime: number,
  fields: Record<string, unknown>
) {
  await supabase
    .from("scrape_runs")
    .update({
      ...fields,
      duration_ms: Date.now() - startTime,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

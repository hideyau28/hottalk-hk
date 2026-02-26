/**
 * Normalize title for content_hash: lowercase + strip punctuation + trim
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * SHA-256 hash of normalized title
 */
export async function contentHash(title: string): Promise<string> {
  const normalized = normalizeTitle(title);
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Strip tracking parameters from URL for canonical_url
 */
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    const trackingPrefixes = ["utm_", "fbclid", "gclid", "ref", "source", "mc_"];
    const keysToRemove: string[] = [];
    u.searchParams.forEach((_val, key) => {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Create a JSON error response
 */
export function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a JSON success response
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Simple in-memory rate limiter (replaces Upstash Redis).
 * Good enough for MVP — resets on redeploy.
 */

const store = new Map<string, { count: number; resetAt: number }>();

export const reportRatelimit = {
  async limit(identifier: string): Promise<{ success: boolean }> {
    const now = Date.now();
    const windowMs = 60_000; // 60 seconds
    const maxRequests = 5;

    const entry = store.get(identifier);

    if (!entry || now > entry.resetAt) {
      store.set(identifier, { count: 1, resetAt: now + windowMs });
      return { success: true };
    }

    if (entry.count >= maxRequests) {
      return { success: false };
    }

    entry.count++;
    return { success: true };
  },
};

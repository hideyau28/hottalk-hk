import { createClient, SupabaseClient } from "@supabase/supabase-js";

const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder";

/**
 * Throws at runtime if required Supabase env vars are missing or still set to
 * placeholder values. Safe to call only from Route Handlers and Server Actions
 * (never from module top-level — that would break next build).
 */
export function assertServerEnv(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || url.includes("placeholder")) {
    throw new Error(
      "Missing env var: NEXT_PUBLIC_SUPABASE_URL is not set or is still the placeholder value.",
    );
  }
  if (!anonKey || anonKey.includes("placeholder")) {
    throw new Error(
      "Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set or is still the placeholder value.",
    );
  }
  if (!serviceKey || serviceKey.includes("placeholder")) {
    throw new Error(
      "Missing env var: SUPABASE_SERVICE_ROLE_KEY is not set or is still the placeholder value.",
    );
  }
}

/**
 * Server-side Supabase client (for Server Components / Route Handlers).
 * Uses service role key for full access.
 * Returns a client even when env vars are missing (build-time safe).
 */
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Build-time safe: if env vars are missing, return a client pointing at a
  // placeholder URL. Callers should treat fetch failures as "no data".
  return createClient(url || PLACEHOLDER_URL, key || PLACEHOLDER_KEY, {
    auth: { persistSession: false },
  });
}

export function hasServerSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * Browser-side Supabase client (for Client Components).
 * Uses anon key with RLS.
 */
export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

  return createClient(url, key);
}

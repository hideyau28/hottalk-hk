import { createClient, SupabaseClient } from "@supabase/supabase-js";

const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder";

/**
 * Server-side Supabase client (for Server Components / Route Handlers).
 * Uses service role key for full access.
 * Returns a client even when env vars are missing (build-time safe).
 */
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || PLACEHOLDER_KEY;

  return createClient(url, key, {
    auth: { persistSession: false },
  });
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

import { createServerClient as createSSRClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder";

/**
 * Create a Supabase client that reads auth session from cookies.
 * Used in middleware and server components to check auth state.
 */
export function createAuthServerClient(
  cookies: {
    getAll: () => { name: string; value: string }[];
    set?: (name: string, value: string, options: Record<string, unknown>) => void;
  }
): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

  return createSSRClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookies.getAll();
      },
      setAll(cookiesToSet) {
        if (cookies.set) {
          for (const { name, value, options } of cookiesToSet) {
            cookies.set(name, value, options);
          }
        }
      },
    },
  });
}

/**
 * Check if an email is in the admin allowlist.
 * ADMIN_EMAILS env var: comma-separated list of admin emails.
 */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const adminEmails = process.env.ADMIN_EMAILS ?? "";
  const allowed = adminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(email.toLowerCase());
}

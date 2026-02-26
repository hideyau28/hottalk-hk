import { NextResponse, type NextRequest } from "next/server";
import { createAuthServerClient } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url));

  const supabase = createAuthServerClient({
    getAll() {
      return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
    },
    set(name: string, value: string, options: Record<string, unknown>) {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    },
  });

  await supabase.auth.signOut();
  return response;
}

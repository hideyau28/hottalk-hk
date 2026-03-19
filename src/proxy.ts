import { NextResponse, type NextRequest } from "next/server";
import { createAuthServerClient, isAdminEmail } from "@/lib/supabase-auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the login page through without auth
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createAuthServerClient({
    getAll() {
      return request.cookies
        .getAll()
        .map((c) => ({ name: c.name, value: c.value }));
    },
    set(name: string, value: string, options: Record<string, unknown>) {
      response.cookies.set(
        name,
        value,
        options as Parameters<typeof response.cookies.set>[2],
      );
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!isAdminEmail(user.email)) {
    return new NextResponse("Forbidden: not an admin user", { status: 403 });
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET ?? "";

// Whitelist of allowed static paths (slugs are handled separately via /topic/<slug>)
const ALLOWED_STATIC_PATHS = new Set([
  "/",
  "/brief",
  "/platform/youtube",
  "/platform/lihkg",
  "/platform/news",
  "/platform/google-trends",
]);

// Only allow slug characters: letters, digits, hyphens
const SLUG_RE = /^[a-z0-9-]+$/;

interface RevalidateBody {
  slugs?: string[];
}

export async function POST(request: NextRequest) {
  try {
    // Verify shared secret
    const authHeader = request.headers.get("authorization") ?? "";
    const secret = request.headers.get("x-revalidation-secret") ?? "";

    if (
      authHeader !== `Bearer ${REVALIDATION_SECRET}` &&
      secret !== REVALIDATION_SECRET
    ) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    const payload: RevalidateBody = await request.json();
    const revalidated: string[] = [];

    // Always revalidate homepage
    revalidatePath("/");
    revalidated.push("/");

    // Revalidate specific topic slugs (whitelist-validated)
    if (payload.slugs) {
      for (const slug of payload.slugs) {
        if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
          return NextResponse.json(
            {
              error: `Invalid slug: "${slug}". Only lowercase letters, digits, and hyphens are allowed.`,
            },
            { status: 400 },
          );
        }
        const path = `/topic/${slug}`;
        revalidatePath(path);
        revalidated.push(path);
      }
    }

    return NextResponse.json({ revalidated: true, paths: revalidated });
  } catch (err) {
    console.error("Revalidation error:", err);
    return NextResponse.json({ error: "Revalidation failed" }, { status: 500 });
  }
}

// Export the allowed paths set so callers can reference them if needed
export { ALLOWED_STATIC_PATHS };

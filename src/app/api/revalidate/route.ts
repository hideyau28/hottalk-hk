import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET ?? "";

interface RevalidateBody {
  paths?: string[];
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

    // Revalidate specific topic slugs
    if (payload.slugs) {
      for (const slug of payload.slugs) {
        const path = `/topic/${slug}`;
        revalidatePath(path);
        revalidated.push(path);
      }
    }

    // Revalidate arbitrary paths
    if (payload.paths) {
      for (const path of payload.paths) {
        revalidatePath(path);
        revalidated.push(path);
      }
    }

    return NextResponse.json({ revalidated: true, paths: revalidated });
  } catch (err) {
    console.error("Revalidation error:", err);
    return NextResponse.json(
      { error: "Revalidation failed" },
      { status: 500 }
    );
  }
}

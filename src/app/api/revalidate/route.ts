import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Receiver } from "@upstash/qstash";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
});

interface RevalidateBody {
  paths?: string[];
  slugs?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("upstash-signature") ?? "";

    // Verify QStash signature
    const isValid = await receiver.verify({
      signature,
      body,
    }).catch(() => false);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: RevalidateBody = JSON.parse(body);
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

"use server";

import { createServerClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

function getDb() {
  return createServerClient();
}

export async function confirmTopic(topicId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDb();

    // Remove suspected_spam flag if present, keep other flags
    const { data: topic } = await db
      .from("topics")
      .select("flags")
      .eq("id", topicId)
      .single();

    const currentFlags: string[] = topic?.flags ?? [];
    const newFlags = currentFlags.filter((f: string) => f !== "suspected_spam");

    await db.from("topics").update({ flags: newFlags }).eq("id", topicId);

    await db.from("audit_log").insert({
      entity_type: "topic",
      entity_id: topicId,
      action: "manual_review",
      actor: "admin",
      details: { action: "confirm" },
    });

    revalidatePath("/admin/topic-review");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function markSpam(topicId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDb();

    const { data: topic } = await db
      .from("topics")
      .select("flags")
      .eq("id", topicId)
      .single();

    const currentFlags: string[] = topic?.flags ?? [];
    const newFlags = Array.from(new Set([...currentFlags, "suspected_spam"]));

    await db
      .from("topics")
      .update({
        status: "archive",
        summary_status: "hidden",
        flags: newFlags,
      })
      .eq("id", topicId);

    await db.from("audit_log").insert({
      entity_type: "topic",
      entity_id: topicId,
      action: "hide",
      actor: "admin",
      details: { action: "mark_spam" },
    });

    revalidatePath("/admin/topic-review");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function mergeTopics(
  sourceId: string,
  targetId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDb();

    // Get source topic slug for alias
    const { data: source } = await db
      .from("topics")
      .select("slug")
      .eq("id", sourceId)
      .single();

    if (!source) return { success: false, error: "Source topic not found" };

    // Archive source, point canonical_id to target
    await db
      .from("topics")
      .update({ canonical_id: targetId, status: "archive" })
      .eq("id", sourceId);

    // Create slug alias for SEO
    try {
      await db.from("topic_aliases").insert({
        old_slug: source.slug,
        topic_id: targetId,
      });
    } catch {
      // Duplicate alias — fine
    }

    // Move topic_posts from source → target
    const { data: sourcePosts } = await db
      .from("topic_posts")
      .select("post_id")
      .eq("topic_id", sourceId);

    if (sourcePosts && sourcePosts.length > 0) {
      for (const tp of sourcePosts) {
        // Upsert to avoid duplicates
        await db
          .from("topic_posts")
          .upsert(
            {
              topic_id: targetId,
              post_id: tp.post_id,
              assigned_method: "manual",
            },
            { onConflict: "topic_id,post_id" },
          );
      }

      // Delete old source links
      await db.from("topic_posts").delete().eq("topic_id", sourceId);
    }

    // Update target post_count and source_count
    const { count } = await db
      .from("topic_posts")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", targetId);

    const { data: platformData } = await db
      .from("topic_posts")
      .select("raw_posts!inner(platform)")
      .eq("topic_id", targetId);

    const platforms = new Set(
      platformData?.flatMap((r: { raw_posts: { platform: string }[] | { platform: string } }) => {
        const rp = r.raw_posts;
        if (Array.isArray(rp)) return rp.map((p) => p.platform);
        return [rp.platform];
      }) ?? [],
    );

    await db
      .from("topics")
      .update({ post_count: count ?? 0, source_count: platforms.size })
      .eq("id", targetId);

    await db.from("audit_log").insert({
      entity_type: "topic",
      entity_id: sourceId,
      action: "merge",
      actor: "admin",
      details: { target_id: targetId, posts_moved: sourcePosts?.length ?? 0 },
    });

    revalidatePath("/admin/topic-review");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function splitTopic(
  topicId: string,
  postIds: string[],
): Promise<{ success: boolean; error?: string }> {
  if (postIds.length === 0) {
    return { success: false, error: "No posts selected for split" };
  }

  try {
    const db = getDb();

    // Rule #7: Topic > 48h cannot be split
    const { data: topic } = await db
      .from("topics")
      .select("first_detected_at")
      .eq("id", topicId)
      .single();

    if (topic) {
      const ageMs = Date.now() - new Date(topic.first_detected_at).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours > 48) {
        return { success: false, error: "Topic > 48h 唔準 split（Rule #7）" };
      }
    }

    // Create new topic
    const tempSlug = `split-${Date.now().toString(36)}`;
    const { data: newTopic, error: createErr } = await db
      .from("topics")
      .insert({
        slug: tempSlug,
        title: "（拆分話題 — 待 AI 摘要）",
        status: "emerging",
        summary_status: "pending",
        post_count: postIds.length,
      })
      .select("id")
      .single();

    if (createErr || !newTopic) {
      return { success: false, error: `Create topic failed: ${createErr?.message}` };
    }

    // Move selected posts to new topic
    for (const postId of postIds) {
      await db.from("topic_posts").upsert(
        {
          topic_id: newTopic.id,
          post_id: postId,
          assigned_method: "manual",
        },
        { onConflict: "topic_id,post_id" },
      );
    }

    // Remove from original topic
    await db
      .from("topic_posts")
      .delete()
      .eq("topic_id", topicId)
      .in("post_id", postIds);

    // Update original topic post_count
    const { count } = await db
      .from("topic_posts")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId);

    await db.from("topics").update({ post_count: count ?? 0 }).eq("id", topicId);

    await db.from("audit_log").insert({
      entity_type: "topic",
      entity_id: topicId,
      action: "split",
      actor: "admin",
      details: {
        new_topic_id: newTopic.id,
        post_ids: postIds,
      },
    });

    revalidatePath("/admin/topic-review");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

"use client";

import { useState, useTransition } from "react";
import { confirmTopic, markSpam, mergeTopics, splitTopic } from "./actions";

interface PostInfo {
  id: string;
  platform: string;
  title: string;
  url: string;
  published_at: string;
}

interface TopicWithPosts {
  id: string;
  slug: string;
  title: string;
  heat_score: number;
  status: string;
  flags: string[];
  post_count: number;
  source_count: number;
  summary: string | null;
  summary_status: string;
  first_detected_at: string;
  posts: PostInfo[];
}

const PLATFORM_EMOJI: Record<string, string> = {
  youtube: "YT",
  lihkg: "LH",
  news: "NW",
  google_trends: "GT",
};

export default function TopicReviewClient({
  topics,
}: {
  topics: TopicWithPosts[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [mergeModalTopic, setMergeModalTopic] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [splitSelections, setSplitSelections] = useState<
    Record<string, Set<string>>
  >({});
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function toggleExpanded(topicId: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  function togglePostSelection(topicId: string, postId: string) {
    setSplitSelections((prev) => {
      const set = new Set(prev[topicId] ?? []);
      if (set.has(postId)) set.delete(postId);
      else set.add(postId);
      return { ...prev, [topicId]: set };
    });
  }

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function handleConfirm(topicId: string) {
    startTransition(async () => {
      const res = await confirmTopic(topicId);
      showMessage(res.success ? "已確認" : `錯誤: ${res.error}`);
    });
  }

  function handleMarkSpam(topicId: string) {
    if (!window.confirm("確定標記為 spam？此操作會 archive 該 topic。")) return;
    startTransition(async () => {
      const res = await markSpam(topicId);
      showMessage(res.success ? "已標記 spam" : `錯誤: ${res.error}`);
    });
  }

  function handleMerge() {
    if (!mergeModalTopic || !mergeTarget.trim()) return;
    startTransition(async () => {
      const res = await mergeTopics(mergeModalTopic, mergeTarget.trim());
      showMessage(
        res.success
          ? "已合併"
          : `合併失敗: ${res.error}`,
      );
      setMergeModalTopic(null);
      setMergeTarget("");
    });
  }

  function handleSplit(topicId: string) {
    const selected = splitSelections[topicId];
    if (!selected || selected.size === 0) {
      showMessage("請先選擇要拆分嘅帖文");
      return;
    }
    startTransition(async () => {
      const res = await splitTopic(topicId, Array.from(selected));
      showMessage(res.success ? "已拆分" : `拆分失敗: ${res.error}`);
      setSplitSelections((prev) => ({ ...prev, [topicId]: new Set() }));
    });
  }

  return (
    <div>
      {message && (
        <div className="fixed right-4 top-20 z-50 rounded bg-zinc-800 px-4 py-2 text-sm text-white shadow-lg">
          {message}
        </div>
      )}

      {/* Merge modal */}
      {mergeModalTopic && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-800">
            <h3 className="mb-3 font-semibold">合併 Topic</h3>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              輸入目標 Topic ID（此 topic 會合併到目標）
            </p>
            <input
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              placeholder="Target Topic UUID"
              className="mb-3 w-full rounded border px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-700"
            />
            <div className="flex gap-2">
              <button
                onClick={handleMerge}
                disabled={isPending}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                確認合併
              </button>
              <button
                onClick={() => setMergeModalTopic(null)}
                className="rounded border px-3 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {topics.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-500">
          暫時冇需要 review 嘅 topics
        </p>
      )}

      <div className="space-y-4">
        {topics.map((topic) => {
          const isExpanded = expandedTopics.has(topic.id);
          const selectedPosts = splitSelections[topic.id] ?? new Set();

          return (
            <div
              key={topic.id}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"
            >
              {/* Topic header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {topic.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                      {topic.heat_score}
                    </span>
                    <span>{topic.status}</span>
                    <span>{topic.post_count} posts</span>
                    <span>{topic.source_count} platforms</span>
                    <span className="font-mono text-[10px]">{topic.id.slice(0, 8)}</span>
                    {topic.flags.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => handleConfirm(topic.id)}
                  disabled={isPending}
                  className="rounded border border-green-300 px-2.5 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-700 dark:text-green-400"
                >
                  Confirm
                </button>
                <button
                  onClick={() => {
                    setMergeModalTopic(topic.id);
                    setMergeTarget("");
                  }}
                  disabled={isPending}
                  className="rounded border border-blue-300 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-400"
                >
                  Merge
                </button>
                <button
                  onClick={() => handleSplit(topic.id)}
                  disabled={isPending || selectedPosts.size === 0}
                  className="rounded border border-amber-300 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400"
                >
                  Split ({selectedPosts.size})
                </button>
                <button
                  onClick={() => handleMarkSpam(topic.id)}
                  disabled={isPending}
                  className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400"
                >
                  Spam
                </button>
                <button
                  onClick={() => toggleExpanded(topic.id)}
                  className="ml-auto text-xs text-zinc-500 hover:text-zinc-700"
                >
                  {isExpanded ? "收起帖文" : `展開帖文 (${topic.posts.length})`}
                </button>
              </div>

              {/* Expandable posts list */}
              {isExpanded && (
                <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-700">
                  {topic.posts.map((post) => (
                    <div
                      key={post.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPosts.has(post.id)}
                        onChange={() =>
                          togglePostSelection(topic.id, post.id)
                        }
                        className="h-3.5 w-3.5"
                      />
                      <span className="w-6 shrink-0 rounded bg-zinc-100 px-1 text-center font-mono text-[10px] dark:bg-zinc-700">
                        {PLATFORM_EMOJI[post.platform] ?? post.platform}
                      </span>
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {post.title}
                      </a>
                      <span className="shrink-0 text-zinc-400">
                        {new Date(post.published_at).toLocaleDateString("zh-HK")}
                      </span>
                    </div>
                  ))}
                  {topic.posts.length === 0 && (
                    <p className="text-xs text-zinc-400">無關聯帖文</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

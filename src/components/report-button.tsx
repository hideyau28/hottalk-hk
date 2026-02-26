"use client";

import { useState } from "react";

const REASONS = [
  "AI 摘要不準確",
  "話題合併錯誤",
  "包含個人私隱",
  "包含不當內容",
  "其他",
] as const;

export function ReportButton({ topicId }: { topicId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(reason: string) {
    setStatus("submitting");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId, reason }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `HTTP ${res.status}`);
      }

      setStatus("success");
      setMessage("已提交舉報，感謝你的回報！");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "提交失敗，請稍後再試");
    }
  }

  if (status === "success" || status === "error") {
    return (
      <span className={`text-xs ${status === "success" ? "text-green-600" : "text-red-600"}`}>
        {message}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        title="舉報此話題"
      >
        ⚠️ 舉報
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {REASONS.map((reason) => (
        <button
          key={reason}
          disabled={status === "submitting"}
          onClick={() => handleSubmit(reason)}
          className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {reason}
        </button>
      ))}
      <button
        onClick={() => setOpen(false)}
        className="px-2 py-0.5 text-xs text-zinc-400"
      >
        取消
      </button>
    </div>
  );
}

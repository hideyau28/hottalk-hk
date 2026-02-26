"use client";

import { useEffect, useState } from "react";

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "剛剛";
  if (diffMin < 60) return `${diffMin} 分鐘前`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} 日前`;
}

export function TimeAgo({ date }: { date: string }) {
  const [text, setText] = useState(() => formatTimeAgo(date));

  useEffect(() => {
    setText(formatTimeAgo(date));
    const id = setInterval(() => {
      setText(formatTimeAgo(date));
    }, 60_000);
    return () => clearInterval(id);
  }, [date]);

  return (
    <time dateTime={date} className="text-sm text-zinc-500" title={new Date(date).toLocaleString("zh-HK")}>
      {text}
    </time>
  );
}

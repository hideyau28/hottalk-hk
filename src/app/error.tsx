"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="text-7xl font-bold text-zinc-200 dark:text-zinc-800">500</p>
      <h1 className="mt-4 text-xl font-bold text-zinc-900 dark:text-zinc-50">
        出咗啲問題
      </h1>
      <p className="mt-2 text-zinc-500">
        伺服器暫時出現問題，請稍後再試。
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        重試
      </button>
    </div>
  );
}

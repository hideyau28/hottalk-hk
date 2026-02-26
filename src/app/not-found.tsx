import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 — 搵唔到頁面",
};

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="text-7xl font-bold text-zinc-200 dark:text-zinc-800">404</p>
      <h1 className="mt-4 text-xl font-bold text-zinc-900 dark:text-zinc-50">
        搵唔到呢個頁面
      </h1>
      <p className="mt-2 text-zinc-500">
        你搵緊嘅頁面可能已經移除、更改咗名稱，或者暫時無法使用。
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        返回首頁
      </Link>
    </div>
  );
}

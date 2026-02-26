import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: "noindex, nofollow",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[60vh]">
      <nav className="mb-6 flex items-center gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        <span className="text-sm font-semibold text-zinc-500">Admin</span>
        <Link
          href="/admin/topic-review"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Topic Review
        </Link>
        <Link
          href="/admin/status"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Status Dashboard
        </Link>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </nav>
      {children}
    </div>
  );
}

function LogoutButton() {
  return (
    <form action="/admin/logout" method="POST">
      <button
        type="submit"
        className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        登出
      </button>
    </form>
  );
}

import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "熱話 HotTalk HK — 一頁睇晒，全港熱話",
    template: "%s | 熱話 HotTalk HK",
  },
  description:
    "香港首個免費跨平台社交媒體熱點聚合平台。AI 自動歸納 YouTube、連登、新聞、Google Trends 熱話。",
  openGraph: {
    siteName: "熱話 HotTalk HK",
    locale: "zh_HK",
    type: "website",
  },
  robots: "index, follow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-HK">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+HK:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                熱話 HotTalk HK
              </span>
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/brief"
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                今日懶人包
              </Link>
              <span className="hidden text-sm text-zinc-500 sm:inline">
                一頁睇晒，全港熱話
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto max-w-5xl px-4 py-6">
            <nav className="flex flex-wrap justify-center gap-4 text-sm text-zinc-500">
              <Link href="/about" className="hover:text-zinc-700 dark:hover:text-zinc-300">
                關於我們
              </Link>
              <Link href="/privacy" className="hover:text-zinc-700 dark:hover:text-zinc-300">
                私隱政策
              </Link>
              <Link href="/terms" className="hover:text-zinc-700 dark:hover:text-zinc-300">
                使用條款
              </Link>
              <Link href="/report" className="hover:text-zinc-700 dark:hover:text-zinc-300">
                舉報指引
              </Link>
            </nav>
            <p className="mt-3 text-center text-sm text-zinc-400">
              &copy; 2026 HotTalk HK
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

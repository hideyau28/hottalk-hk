import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "關於我們",
  description:
    "HotTalk HK 係香港首個免費跨平台社交媒體熱點聚合平台，用 AI 將 YouTube、連登、新聞、Google Trends 嘅熱話自動歸類。",
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        關於 HotTalk HK
      </h1>

      <div className="mt-8 space-y-8 text-zinc-700 dark:text-zinc-300">
        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">我哋係邊個</h2>
          <p className="mt-2 leading-relaxed">
            HotTalk HK（熱話）係香港首個免費跨平台社交媒體熱點聚合平台。我哋嘅目標好簡單
            — 等你打開一個網站，3 分鐘內就睇晒全港網絡熱話。
          </p>
          <p className="mt-3 leading-relaxed">
            香港人平均同時使用 6.4 個社交平台。每日要碌 YouTube、連登、各大新聞 app
            先知「今日講緊乜」，實在太花時間。HotTalk HK 用 AI
            技術自動收集同歸納各平台嘅熱門話題，一頁睇晒。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">數據來源</h2>
          <p className="mt-2 leading-relaxed">
            我哋從以下公開平台收集熱門話題 metadata：
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">YouTube</p>
              <p className="mt-1 text-sm">
                透過官方 YouTube Data API v3 收集香港地區熱門影片嘅標題、觀看次數同互動數據。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">新聞 RSS</p>
              <p className="mt-1 text-sm">
                透過 RSS 訂閱收集香港主要新聞媒體（HK01、南華早報、明報、東網、星島等）嘅頭條。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">Google Trends</p>
              <p className="mt-1 text-sm">
                收集 Google 搜尋趨勢數據，用作話題「破圈」驗證同熱度加權信號。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">LIHKG 連登</p>
              <p className="mt-1 text-sm">
                收集連登討論區嘅帖文標題同互動數據（只收集 metadata，唔存儲帖文全文）。
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">AI 技術</h2>
          <p className="mt-2 leading-relaxed">
            我哋使用人工智能技術自動處理數據：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>話題聚類</strong> — 自動識別同一事件嘅不同報導，歸類成一個話題
            </li>
            <li>
              <strong>AI 摘要</strong> — 自動生成簡短嘅話題摘要，方便快速了解事件概要
            </li>
            <li>
              <strong>情緒分析</strong> — 分析各平台用戶對話題嘅正面、中立、負面情緒分佈
            </li>
            <li>
              <strong>熱度評分</strong> — 綜合各平台數據計算話題熱度，實時排名
            </li>
          </ul>
          <p className="mt-3 leading-relaxed">
            所有 AI 生成嘅內容都會清楚標示，我哋唔會將 AI 摘要呈現為新聞報導或事實陳述。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">我哋嘅原則</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>免費開放</strong> — 核心功能永遠免費，唔需要註冊登入
            </li>
            <li>
              <strong>中立客觀</strong> — 唔帶任何政治或商業立場
            </li>
            <li>
              <strong>尊重版權</strong> — 只展示標題 + AI 摘要 + 原文連結，唔存儲原文內容
            </li>
            <li>
              <strong>保障私隱</strong> — 唔追蹤用戶、唔賣數據
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">聯絡我哋</h2>
          <p className="mt-2 leading-relaxed">
            一般查詢：{" "}
            <a
              href="mailto:hello@hottalk.hk"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              hello@hottalk.hk
            </a>
          </p>
          <p className="mt-1 leading-relaxed">
            私隱相關：{" "}
            <a
              href="mailto:privacy@hottalk.hk"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              privacy@hottalk.hk
            </a>
          </p>
          <p className="mt-1 leading-relaxed">
            內容舉報：{" "}
            <a
              href="mailto:report@hottalk.hk"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              report@hottalk.hk
            </a>
          </p>
        </section>
      </div>
    </article>
  );
}

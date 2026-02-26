import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "內容舉報指引",
  description: "HotTalk HK 內容舉報指引 — 了解點樣舉報錯誤內容同版權投訴流程。",
};

export default function ReportGuidePage() {
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        內容舉報指引
      </h1>
      <p className="mt-2 text-sm text-zinc-500">最後更新：2026 年 2 月 26 日</p>

      <div className="mt-8 space-y-8 text-zinc-700 dark:text-zinc-300">
        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">點樣舉報內容</h2>
          <p className="mt-2 leading-relaxed">
            如果你發現任何話題內容有問題，可以直接喺話題頁面點擊「舉報」按鈕。你唔需要註冊或登入就可以舉報。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">舉報原因</h2>
          <p className="mt-2 leading-relaxed">你可以揀選以下舉報原因：</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">AI 摘要不準確</p>
              <p className="mt-1 text-sm">
                AI 生成嘅摘要同實際內容有出入，包括事實錯誤、重要遺漏或誤導性描述。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">話題合併錯誤</p>
              <p className="mt-1 text-sm">
                AI 將兩件不同嘅事件歸類咗做同一個話題，導致混淆。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">包含個人私隱</p>
              <p className="mt-1 text-sm">
                話題內容包含個人私隱資料，例如電話號碼、住址、身分證號碼等。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">包含不當內容</p>
              <p className="mt-1 text-sm">
                話題內容包含色情、暴力、仇恨言論或其他違反社會規範嘅內容。
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-bold text-zinc-900 dark:text-zinc-50">其他</p>
              <p className="mt-1 text-sm">
                以上原因都唔適用嘅情況，請喺舉報時簡述問題。
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">處理流程</h2>
          <div className="mt-4 space-y-4">
            <div className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                1
              </span>
              <div>
                <p className="font-bold text-zinc-900 dark:text-zinc-50">提交舉報</p>
                <p className="mt-1 text-sm">你提交舉報後，系統會即時記錄。</p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                2
              </span>
              <div>
                <p className="font-bold text-zinc-900 dark:text-zinc-50">自動處理</p>
                <p className="mt-1 text-sm">
                  同一話題被舉報 3 次或以上，系統會自動隱藏 AI 摘要（保留標題同原文連結）。被舉報 5
                  次或以上，話題會自動下架。
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                3
              </span>
              <div>
                <p className="font-bold text-zinc-900 dark:text-zinc-50">人工審核</p>
                <p className="mt-1 text-sm">
                  管理員每日審核所有被舉報嘅話題，進行最終處理決定。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">版權投訴</h2>
          <p className="mt-2 leading-relaxed">
            如果你係版權持有人，認為本平台侵犯咗你嘅版權，請電郵至{" "}
            <a
              href="mailto:report@hottalk.hk"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              report@hottalk.hk
            </a>
            ，並提供以下資料：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>你嘅身份證明（姓名、聯絡方式）</li>
            <li>版權持有嘅證明</li>
            <li>涉及侵權嘅具體頁面連結</li>
            <li>你希望我哋採取嘅行動</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            我哋會喺收到投訴後 <strong>24 小時內</strong>處理，通常做法係移除 AI
            生成嘅摘要，保留標題同原文連結。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">注意事項</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>請勿濫用舉報功能，系統設有速率限制</li>
            <li>舉報唔需要提供個人資料</li>
            <li>我哋唔會公開舉報者嘅身份</li>
          </ul>
        </section>

        <section>
          <p className="leading-relaxed">
            如有其他問題，歡迎查閱我哋嘅{" "}
            <Link
              href="/terms"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              使用條款
            </Link>{" "}
            或{" "}
            <Link
              href="/privacy"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              私隱政策
            </Link>
            。
          </p>
        </section>
      </div>
    </article>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "私隱政策",
  description: "HotTalk HK 私隱政策 — 了解我哋點樣處理數據同保障你嘅私隱。",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        私隱政策
      </h1>
      <p className="mt-2 text-sm text-zinc-500">最後更新：2026 年 2 月 26 日</p>

      <div className="mt-8 space-y-8 text-zinc-700 dark:text-zinc-300">
        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">1. 概要</h2>
          <p className="mt-2 leading-relaxed">
            HotTalk HK（「本平台」）係一個免費跨平台社交媒體熱點聚合平台。本私隱政策說明我哋點樣收集、使用同保護數據。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">2. 我哋收集咩數據</h2>
          <p className="mt-2 leading-relaxed">
            本平台<strong>只收集公開平台嘅 metadata</strong>，包括：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>公開帖文標題</li>
            <li>公開互動數據（觀看次數、讚好數、留言數）</li>
            <li>原文連結（URL）</li>
            <li>發佈時間同作者公開名稱</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            我哋<strong>唔會</strong>收集以下資料：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>用戶個人資料（姓名、電郵、電話等）</li>
            <li>帖文全文內容</li>
            <li>用戶瀏覽記錄或行為追蹤數據</li>
            <li>跨平台身份關聯</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">3. 用戶追蹤</h2>
          <p className="mt-2 leading-relaxed">
            本平台<strong>唔使用任何用戶追蹤技術</strong>。我哋唔使用 Google Analytics、Facebook Pixel
            或其他第三方追蹤工具。我哋唔會追蹤你嘅瀏覽行為，亦唔會出售任何數據。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">4. Cookie 使用</h2>
          <p className="mt-2 leading-relaxed">
            本平台只喺管理員登入時使用 session cookie，用於維持管理員嘅登入狀態。普通訪客瀏覽本網站時唔會設置任何
            cookie。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">5. 舉報功能同 IP 處理</h2>
          <p className="mt-2 leading-relaxed">
            當你使用內容舉報功能時，我哋會收集你嘅 IP 地址並即時進行 SHA-256 雜湊處理。我哋
            <strong>唔會儲存原始 IP 地址</strong>
            ，雜湊後嘅值只用於防止濫用舉報功能。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">6. 第三方服務</h2>
          <p className="mt-2 leading-relaxed">本平台使用以下第三方服務：</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>Vercel</strong> — 網站託管
            </li>
            <li>
              <strong>Supabase</strong> — 數據庫服務
            </li>
            <li>
              <strong>Upstash</strong> — 快取同速率限制
            </li>
          </ul>
          <p className="mt-2 leading-relaxed">
            以上服務可能會收集基本嘅伺服器日誌（如 IP 地址），詳情請參閱各服務嘅私隱政策。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">7. 數據保留</h2>
          <p className="mt-2 leading-relaxed">
            公開平台 metadata 會保留用於熱話分析。過時嘅話題數據會定期清理。舉報記錄會保留以供管理員審核。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">8. 你嘅權利</h2>
          <p className="mt-2 leading-relaxed">
            根據香港《個人資料（私隱）條例》（第 486 章），你有權要求查閱同更正你嘅個人資料。如果你認為本平台展示咗你嘅個人資料，請透過以下方式聯絡我哋。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">9. 政策更新</h2>
          <p className="mt-2 leading-relaxed">
            我哋可能會不時更新本私隱政策。任何重大變更會喺本頁面公佈。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">10. 聯絡我哋</h2>
          <p className="mt-2 leading-relaxed">
            如有任何私隱相關查詢，請電郵至{" "}
            <a
              href="mailto:privacy@hottalk.hk"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              privacy@hottalk.hk
            </a>
            。
          </p>
        </section>
      </div>
    </article>
  );
}

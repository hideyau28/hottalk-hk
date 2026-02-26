import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "使用條款",
  description: "HotTalk HK 使用條款 — 使用本平台前請閱讀以下條款。",
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        使用條款
      </h1>
      <p className="mt-2 text-sm text-zinc-500">最後更新：2026 年 2 月 26 日</p>

      <div className="mt-8 space-y-8 text-zinc-700 dark:text-zinc-300">
        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">1. 服務簡介</h2>
          <p className="mt-2 leading-relaxed">
            HotTalk HK（「本平台」）係一個免費嘅跨平台社交媒體熱點聚合服務。我哋透過 AI
            技術自動收集、分析同歸納來自多個公開平台嘅熱門話題。使用本平台即表示你同意以下條款。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            2. AI 生成內容免責聲明
          </h2>
          <p className="mt-2 leading-relaxed">
            本平台使用人工智能（AI）技術自動生成話題摘要同分類。請注意：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>AI 摘要由機器自動生成，<strong>可能存在不準確、遺漏或錯誤</strong></li>
            <li>話題聚類結果可能將不相關嘅內容歸入同一話題</li>
            <li>情緒分析結果僅供參考，唔代表任何立場</li>
            <li>AI 生成嘅內容唔構成事實陳述、專業意見或新聞報導</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            如發現 AI 摘要有誤，歡迎透過舉報功能通知我哋。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">3. 版權聲明</h2>
          <p className="mt-2 leading-relaxed">本平台對原始內容嘅使用方式如下：</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>只展示原文標題</strong>同 AI 生成嘅簡短摘要（約 50 字）
            </li>
            <li>
              <strong>提供原文連結</strong>，引導用戶到原始平台閱讀全文
            </li>
            <li>
              <strong>唔儲存或展示原文內容</strong>
            </li>
            <li>清楚標明每篇內容嘅來源平台</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            以上做法符合香港《版權條例》中「公平處理」（Fair Dealing）嘅原則。所有原始內容嘅版權屬於各自嘅版權持有人。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">4. 版權投訴</h2>
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
            <li>你嘅身份證明同版權持有證明</li>
            <li>涉及侵權嘅具體內容連結</li>
            <li>你希望採取嘅行動</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            我哋會喺收到投訴後 <strong>24 小時內</strong>移除相關 AI 摘要，保留標題同原文連結。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">5. 用戶舉報機制</h2>
          <p className="mt-2 leading-relaxed">任何人都可以透過話題頁面嘅「舉報」按鈕報告問題。舉報原因包括：</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>AI 摘要不準確</li>
            <li>話題合併錯誤（應該係兩件不同嘅事）</li>
            <li>包含個人私隱</li>
            <li>包含不當內容</li>
            <li>其他</li>
          </ul>
          <p className="mt-3 leading-relaxed">處理流程：</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>被舉報 3 次或以上 — 自動隱藏 AI 摘要（保留標題同連結）</li>
            <li>被舉報 5 次或以上 — 自動下架整個話題</li>
            <li>管理員每日審核所有被舉報嘅話題</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">6. 使用限制</h2>
          <p className="mt-2 leading-relaxed">使用本平台時，你唔可以：</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>對本平台進行自動化大量抓取（scraping）</li>
            <li>濫用舉報功能</li>
            <li>嘗試未經授權存取管理員功能</li>
            <li>利用本平台進行任何違法活動</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">7. 免責聲明</h2>
          <p className="mt-2 leading-relaxed">
            本平台「按現狀」提供，唔作任何明示或暗示嘅保證。我哋唔對以下情況負責：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>AI 生成內容嘅準確性或完整性</li>
            <li>服務中斷或數據延遲</li>
            <li>因使用本平台資訊而導致嘅任何損失</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">8. 條款修改</h2>
          <p className="mt-2 leading-relaxed">
            我哋保留隨時修改本使用條款嘅權利。重大變更會喺本頁面公佈。繼續使用本平台即表示你接受修改後嘅條款。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">9. 適用法律</h2>
          <p className="mt-2 leading-relaxed">
            本使用條款受香港特別行政區法律管轄。如有任何爭議，雙方同意接受香港法院嘅專屬管轄權。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">10. 聯絡我哋</h2>
          <p className="mt-2 leading-relaxed">
            如有任何關於使用條款嘅查詢，請電郵至{" "}
            <a
              href="mailto:hello@hottalk.hk"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              hello@hottalk.hk
            </a>
            。
          </p>
        </section>
      </div>
    </article>
  );
}

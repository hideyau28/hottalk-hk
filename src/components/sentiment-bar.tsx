export function SentimentBar({
  positive,
  negative,
  neutral,
}: {
  positive: number;
  negative: number;
  neutral: number;
}) {
  const total = positive + negative + neutral;
  if (total === 0) return null;

  const pPct = Math.round((positive / total) * 100);
  const nPct = Math.round((negative / total) * 100);
  const uPct = 100 - pPct - nPct;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {pPct > 0 && (
          <div
            className="bg-green-500"
            style={{ width: `${pPct}%` }}
            title={`正面 ${pPct}%`}
          />
        )}
        {uPct > 0 && (
          <div
            className="bg-zinc-300 dark:bg-zinc-600"
            style={{ width: `${uPct}%` }}
            title={`中立 ${uPct}%`}
          />
        )}
        {nPct > 0 && (
          <div
            className="bg-red-500"
            style={{ width: `${nPct}%` }}
            title={`負面 ${nPct}%`}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>👍 {pPct}%</span>
        <span>😐 {uPct}%</span>
        <span>👎 {nPct}%</span>
      </div>
    </div>
  );
}

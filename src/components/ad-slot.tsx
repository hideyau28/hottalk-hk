export function AdSlot({ slot = "default" }: { slot?: string }) {
  return (
    <div
      data-ad-slot={slot}
      className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
    >
      廣告
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mt-4 flex flex-col gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="flex-1 space-y-3">
              <div className="h-5 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-4 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-5 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-5 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const LEVELS = [
  { max: 2000, fires: 1, color: "text-amber-500" },
  { max: 4000, fires: 2, color: "text-amber-600" },
  { max: 6000, fires: 3, color: "text-orange-500" },
  { max: 8000, fires: 4, color: "text-orange-600" },
  { max: 10000, fires: 5, color: "text-red-600" },
] as const;

function getLevel(score: number) {
  for (const level of LEVELS) {
    if (score <= level.max) return level;
  }
  return LEVELS[LEVELS.length - 1];
}

export function HeatIndicator({ score }: { score: number }) {
  const level = getLevel(score);

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${level.color}`}>
      <span aria-label={`Heat level ${level.fires}`}>
        {"🔥".repeat(level.fires)}
      </span>
      <span className="text-sm tabular-nums">{score.toLocaleString()}</span>
    </span>
  );
}

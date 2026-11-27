import type { Level } from "@/lib/api";

const STYLES: Record<Level, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};
const LABELS: Record<Level, string> = { low: "No concerns", medium: "Some concerns", high: "Needs review" };

export default function RiskBadge({ level, score }: { level: Level; score: number }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[level]}`}>
      {LABELS[level]} · {score}
    </span>
  );
}

import type { PublicPlayer } from "@/features/game/types";

export function Leaderboard({ players, compact = false }: { players: PublicPlayer[]; compact?: boolean }) {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  return <div className="space-y-2" aria-label="Leaderboard">
    {ranked.map((player, index) => <div key={player.userId} className={`flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
      <span className="w-7 text-lg font-black text-zinc-500">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate font-bold">{player.displayName}</span>
      <span className="text-xl font-black tabular-nums">{player.score}</span>
    </div>)}
  </div>;
}

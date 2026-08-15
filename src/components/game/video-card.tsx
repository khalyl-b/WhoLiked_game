import type { PublicRound } from "@/features/game/types";

export function VideoCard({ round }: { round: PublicRound }) {
  return <div className="panel overflow-hidden">
    <div className="aspect-[9/12] min-h-72 bg-gradient-to-b from-zinc-800 to-zinc-950 p-6 sm:aspect-video">
      <div className="flex h-full flex-col justify-end">
        <div className="mb-auto flex items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-zinc-400"><span>Fake TikTok fixture</span><span>#{round.activity?.videoId.slice(-8)}</span></div>
        <p className="text-2xl font-black sm:text-4xl">{round.activity?.title ?? "TikTok activity"}</p>
        <p className="mt-2 text-zinc-300">{round.activity?.creator ?? "@creator"}</p>
        {round.activity?.videoUrl && <a target="_blank" rel="noreferrer" className="focus-ring mt-5 w-fit rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/15" href={round.activity.videoUrl}>Open fixture URL ↗</a>}
      </div>
    </div>
  </div>;
}

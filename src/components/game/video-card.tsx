import type { PublicRound } from "@/features/game/types";

function isFixtureVideo(videoId: string | undefined) {
  return !videoId || videoId.startsWith("fake-");
}

function embedUrl(videoId: string | undefined) {
  if (!videoId || !/^\d{6,19}$/.test(videoId)) return null;
  return `https://www.tiktok.com/player/v1/${videoId}?autoplay=0&loop=1&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=1&music_info=1&description=1&rel=0`;
}

export function VideoCard({ round }: { round: PublicRound }) {
  const activity = round.activity;
  const fixture = isFixtureVideo(activity?.videoId);
  const playerUrl = fixture ? null : embedUrl(activity?.videoId);

  if (playerUrl) {
    return <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
        <span>TikTok</span>
        <a
          target="_blank"
          rel="noreferrer"
          className="focus-ring rounded-lg px-2 py-1 normal-case tracking-normal text-zinc-200 hover:bg-white/10"
          href={activity?.videoUrl}
        >Open on TikTok ↗</a>
      </div>
      <div className="mx-auto w-full max-w-[430px] bg-black">
        <iframe
          className="aspect-[9/16] w-full border-0"
          src={playerUrl}
          title="TikTok for the current guessing round"
          loading="eager"
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>;
  }

  return <div className="panel overflow-hidden">
    <div className="aspect-[9/12] min-h-72 bg-gradient-to-b from-zinc-800 to-zinc-950 p-6 sm:aspect-video">
      <div className="flex h-full flex-col justify-end">
        <div className="mb-auto flex items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
          <span>{fixture ? "Development TikTok fixture" : "TikTok"}</span>
          {fixture && activity?.videoId && <span>#{activity.videoId.slice(-8)}</span>}
        </div>
        <p className="text-2xl font-black sm:text-4xl">{activity?.title ?? (fixture ? "TikTok activity" : "TikTok video")}</p>
        {activity?.creator && <p className="mt-2 text-zinc-300">{activity.creator}</p>}
        {activity?.videoUrl && <a target="_blank" rel="noreferrer" className="focus-ring mt-5 w-fit rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/15" href={activity.videoUrl}>{fixture ? "Open fixture URL" : "Open on TikTok"} ↗</a>}
      </div>
    </div>
  </div>;
}

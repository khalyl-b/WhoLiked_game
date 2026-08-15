"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicRound } from "@/features/game/types";

function isFixtureVideo(videoId: string | undefined) {
  return !videoId || videoId.startsWith("fake-");
}

function embedUrl(videoId: string | undefined) {
  if (!videoId || !/^\d{6,19}$/.test(videoId)) return null;
  return `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&muted=0&loop=1&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=1&music_info=1&description=1&rel=0`;
}

export function VideoCard({
  round,
  onReady,
  onUnavailable,
  replacing = false,
}: {
  round: PublicRound;
  onReady?: (videoId: string) => void;
  onUnavailable?: (roundId: string, videoId: string) => void;
  replacing?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reportedUnavailable = useRef(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const unmuteAttempts = useRef(0);
  const [playerReady, setPlayerReady] = useState(false);
  const activity = round.activity;
  const fixture = isFixtureVideo(activity?.videoId);
  const playerUrl = fixture ? null : embedUrl(activity?.videoId);

  useEffect(() => {
    reportedUnavailable.current = false;
    setPlayerReady(false);
    setSoundBlocked(false);
    unmuteAttempts.current = 0;
  }, [round.id, activity?.videoId]);

  useEffect(() => {
    if (fixture && activity?.videoId) {
      onReady?.(activity.videoId);
    }
  }, [fixture, activity?.videoId, onReady]);

  useEffect(() => {
    if (!playerUrl || !activity?.videoId) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        "x-tiktok-player"?: boolean;
        type?: string;
        value?: boolean | number | { errorCode?: number; errorType?: string };
      } | undefined;
      if (!data?.["x-tiktok-player"]) return;
      const errorValue = typeof data.value === "object" && data.value ? data.value : undefined;

      if (data.type === "onPlayerReady") {
        setPlayerReady(true);
        onReady?.(activity.videoId);
        const target = iframeRef.current?.contentWindow;
        // The round timer is already running server-side. As soon as TikTok says
        // this post is playable, make the player visible and request normal
        // unmuted autoplay. No cross-player playback synchronisation is used.
        target?.postMessage({ type: "unMute", value: undefined, "x-tiktok-player": true }, "https://www.tiktok.com");
        target?.postMessage({ type: "play", value: undefined, "x-tiktok-player": true }, "https://www.tiktok.com");
        return;
      }

      if (data.type === "onPlayerError" && errorValue?.errorType === "INVALID_VIDEO") {
        // TikTok documents INVALID_VIDEO (1001) as "Invalid Media ID, no
        // video/photo found". The iframe stays hidden and the server swaps this
        // round's activity before any player is allowed to guess.
        if (!reportedUnavailable.current) {
          reportedUnavailable.current = true;
          onUnavailable?.(round.id, activity.videoId);
        }
        return;
      }

      if (data.type === "onMute" && data.value === true) {
        if (unmuteAttempts.current < 2) {
          unmuteAttempts.current += 1;
          iframeRef.current?.contentWindow?.postMessage(
            { type: "unMute", value: undefined, "x-tiktok-player": true },
            "https://www.tiktok.com",
          );
        } else {
          setSoundBlocked(true);
        }
        return;
      }

      if (data.type === "onPlayerError" && errorValue?.errorType === "AUTOPLAY_ERROR") {
        // Audible autoplay can be blocked by the browser itself. Do not silently
        // switch to muted playback; preserve the user's requested sound-first
        // behaviour and expose one user-gesture fallback instead.
        setSoundBlocked(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [playerUrl, round.id, activity?.videoId, onReady, onUnavailable]);


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
      <div className="relative mx-auto w-full max-w-[430px] bg-black">
        {!playerReady && <div className="absolute inset-0 z-10 flex aspect-[9/16] items-center justify-center bg-zinc-950 px-6 text-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">{replacing ? "Replacing unavailable TikTok" : "Checking TikTok"}</p>
            <p className="mt-2 text-sm text-zinc-400">{replacing ? "Finding another playable video…" : "The video will appear as soon as TikTok confirms it can load."}</p>
          </div>
        </div>}
        <iframe
          ref={iframeRef}
          className={`aspect-[9/16] w-full border-0 transition-opacity ${playerReady ? "opacity-100" : "opacity-0"}`}
          src={playerUrl}
          title="TikTok for the current guessing round"
          loading="eager"
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {soundBlocked && playerReady && <div className="border-t border-white/8 px-4 py-3 text-center">
        <button
          type="button"
          className="focus-ring rounded-xl bg-white px-4 py-2 text-sm font-black text-black"
          onClick={() => {
            const target = iframeRef.current?.contentWindow;
            target?.postMessage({ type: "unMute", value: undefined, "x-tiktok-player": true }, "https://www.tiktok.com");
            target?.postMessage({ type: "play", value: undefined, "x-tiktok-player": true }, "https://www.tiktok.com");
            setSoundBlocked(false);
          }}
        >Play with sound</button>
        <p className="mt-2 text-xs text-zinc-500">Your browser blocked audible autoplay. One click enables sound without muting the round by default.</p>
      </div>}
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

"use client";
import type { PublicRoomState } from "@/features/game/types";
import { Button } from "@/components/ui/button";

export function Lobby({ state, busy, onStart, onLeave, onKick }: { state: PublicRoomState; busy: boolean; onStart: () => void; onLeave: () => void; onKick: (userId: string) => void }) {
  const isHost = state.room.hostUserId === state.viewerUserId;
  async function copyCode() { await navigator.clipboard?.writeText(state.room.code); }
  return <main className="shell py-6 sm:py-10">
    <div className="mx-auto max-w-2xl">
      <div className="text-center"><p className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-500">Room</p><button onClick={copyCode} className="focus-ring mt-1 rounded-xl px-3 py-1 text-4xl font-black tracking-[0.14em] sm:text-5xl" title="Copy room code">{state.room.code}</button><p className="mt-1 text-sm text-zinc-500">Tap code to copy</p></div>
      <section className="panel mt-7 p-5 sm:p-7">
        <div className="flex items-center justify-between"><h1 className="text-2xl font-black">Lobby</h1><span className="rounded-full bg-white/7 px-3 py-1 text-sm font-bold">{state.players.length}/10</span></div>
        <div className="mt-5 space-y-2">{state.players.map((player) => <div key={player.userId} className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${player.connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
          <span className="min-w-0 flex-1 truncate font-bold">{player.displayName}{player.isHost ? " · Host" : ""}</span>
          <span className={`text-xs font-bold ${player.eligibleActivityCount >= 10 ? "text-emerald-300" : "text-amber-300"}`}>{player.eligibleActivityCount}/10 videos</span>{isHost && player.userId !== state.viewerUserId && <button type="button" onClick={() => onKick(player.userId)} className="focus-ring rounded-lg px-2 py-1 text-xs font-bold text-zinc-500 hover:bg-white/5 hover:text-red-200">Kick</button>}
        </div>)}</div>
        <div className="mt-6 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white/5 p-3"><div className="text-lg font-black">{state.room.settings.roundCount}</div><div className="text-xs text-zinc-500">Rounds</div></div><div className="rounded-xl bg-white/5 p-3"><div className="text-lg font-black">Likes</div><div className="text-xs text-zinc-500">Source</div></div><div className="rounded-xl bg-white/5 p-3"><div className="text-lg font-black">{state.room.settings.guessDurationSeconds === 0 ? "Unlimited" : `${state.room.settings.guessDurationSeconds}s`}</div><div className="text-xs text-zinc-500">Timer</div></div></div>
        {isHost ? <div className="mt-6"><Button className="w-full text-lg" onClick={onStart} disabled={busy || !state.canStart}>{busy ? "Starting…" : "Start game"}</Button>{state.startBlockReason && <p className="mt-3 text-center text-sm text-amber-300">{state.startBlockReason}</p>}</div> : <p className="mt-6 text-center text-sm text-zinc-400">Waiting for the host to start…</p>}
        <button className="focus-ring mx-auto mt-5 block text-sm font-bold text-zinc-500 hover:text-white" onClick={onLeave}>Leave room</button>
      </section>
    </div>
  </main>;
}

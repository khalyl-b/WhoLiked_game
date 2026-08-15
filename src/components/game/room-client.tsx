"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useRoomState } from "@/features/rooms/use-room-state";
import { Lobby } from "@/components/lobby/lobby";
import { Countdown } from "./countdown";
import { VideoCard } from "./video-card";
import { Leaderboard } from "./leaderboard";
import { Button } from "@/components/ui/button";

async function postAction(code: string, action: string, body?: unknown) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/${action}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Action failed.");
  return data;
}

export function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const { state, error, reconnecting, refresh } = useRoomState(code);
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");

  async function run(action: string, body?: unknown, after?: () => void) {
    setBusyAction(action); setActionError("");
    try { await postAction(code, action, body); await refresh(); after?.(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Action failed."); }
    finally { setBusyAction(""); }
  }

  if (error && !state) return <main className="shell flex min-h-screen items-center justify-center py-10"><div className="panel max-w-md p-7 text-center"><h1 className="text-2xl font-black">Can’t open room</h1><p className="mt-3 text-zinc-300">{error}</p><Button className="mt-5" onClick={() => router.push("/join")}>Join a room</Button></div></main>;
  if (!state) return <main className="shell flex min-h-screen items-center justify-center"><p className="text-zinc-400">Loading room…</p></main>;

  const host = state.room.hostUserId === state.viewerUserId;
  const currentPlayer = state.players.find((player) => player.userId === state.viewerUserId);

  if (state.room.status === "LOBBY") {
    return <><ConnectionBanner show={reconnecting} /><Lobby state={state} busy={busyAction === "start"} onStart={() => void run("start")} onLeave={() => void run("leave", undefined, () => router.push("/"))} onKick={(targetUserId) => void run("kick", { targetUserId })} />{actionError && <FloatingError text={actionError} />}</>;
  }

  if (state.room.status === "FINISHED") {
    const ranked = [...state.players].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
    const winner = ranked[0];
    return <main className="shell py-8 sm:py-12"><ConnectionBanner show={reconnecting} /><motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-xl text-center">
      <p className="text-sm font-bold uppercase tracking-[.22em] text-zinc-500">Winner</p>
      <h1 className="mt-2 text-5xl font-black sm:text-7xl">{winner?.displayName ?? "Game over"}</h1>
      <p className="mt-2 text-zinc-400">{winner?.score ?? 0} points</p>
      <div className="panel mt-8 p-5 text-left"><Leaderboard players={state.players} /></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{host && <Button onClick={() => void run("rematch")} disabled={!!busyAction}>{busyAction === "rematch" ? "Resetting…" : "Play again"}</Button>}<Button variant="secondary" onClick={() => void run("leave", undefined, () => router.push("/"))}>Leave game</Button></div>
      {actionError && <p role="alert" className="mt-4 text-sm text-red-200">{actionError}</p>}
    </motion.section></main>;
  }

  const round = state.round;
  if (!round) return <main className="shell flex min-h-screen items-center justify-center"><p>Preparing round…</p></main>;
  const revealing = round.status === "REVEAL" || round.status === "FINISHED";

  return <main className="shell py-5 sm:py-8">
    <ConnectionBanner show={reconnecting} />
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-zinc-500">Round</p><p className="text-xl font-black">{round.roundNumber} / {state.room.settings.roundCount}</p></div>{!revealing && <Countdown deadline={round.answerDeadline} serverTime={state.serverTime} />}</header>
      <AnimatePresence mode="wait">
        {revealing ? <motion.section key={`reveal-${round.id}`} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
          <div className="panel p-6 text-center sm:p-8"><p className="text-sm font-bold uppercase tracking-[.18em] text-zinc-500">It was…</p><h1 className="mt-2 text-5xl font-black text-cyan-300 sm:text-7xl">{round.sourceDisplayName}</h1>
            <div className="mt-6 space-y-2 text-left">{state.players.map((player) => {
              const guess = round.guesses?.find((item) => item.guessingUserId === player.userId);
              return <div key={player.userId} className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3"><span className="min-w-0 flex-1 truncate font-bold">{player.displayName}</span><span className={`text-sm font-black ${guess?.correct ? "text-emerald-300" : "text-zinc-400"}`}>{guess ? (guess.correct ? "Correct +1" : "Wrong") : "No guess"}</span></div>;
            })}</div>
          </div>
          <div className="mt-4"><Leaderboard players={state.players} compact /></div>
        </motion.section> : <motion.section key={`active-${round.id}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
          <VideoCard round={round} />
          <h1 className="mt-6 text-center text-2xl font-black sm:text-3xl">Who liked this?</h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{state.players.map((player) => {
            const locked = !!state.viewerGuess;
            const selected = state.viewerGuess === player.userId;
            return <motion.button whileTap={{ scale: .98 }} key={player.userId} disabled={locked || !!busyAction} onClick={() => void run("guess", { guessedUserId: player.userId })} aria-pressed={selected} className={`focus-ring min-h-16 rounded-2xl border px-5 text-lg font-black transition ${selected ? "border-cyan-300 bg-cyan-300 text-black" : "border-white/10 bg-white/6 hover:bg-white/10"} disabled:cursor-not-allowed`}>{player.displayName}</motion.button>;
          })}</div>
          {state.viewerGuess && <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 text-center font-black text-cyan-300">Guess locked</motion.p>}
        </motion.section>}
      </AnimatePresence>
      {host && state.room.status === "ACTIVE" && <div className="mt-6 flex justify-center gap-3"><Button variant="secondary" disabled={!!busyAction} onClick={() => void run("skip")}>Skip round</Button><Button variant="danger" disabled={!!busyAction} onClick={() => void run("end")}>End game</Button></div>}
      {currentPlayer && <p className="mt-6 text-center text-xs text-zinc-600">Playing as {currentPlayer.displayName}</p>}
      {actionError && <p role="alert" className="mt-4 text-center text-sm text-red-200">{actionError}</p>}
    </div>
  </main>;
}

function ConnectionBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return <div role="status" className="fixed inset-x-0 top-0 z-50 bg-amber-400 px-4 py-2 text-center text-sm font-black text-black">Reconnecting… game state will resynchronise automatically.</div>;
}

function FloatingError({ text }: { text: string }) {
  return <div role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white shadow-xl">{text}</div>;
}

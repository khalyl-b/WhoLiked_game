"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { calculateDisplayedPotentialPoints, MAX_CORRECT_GUESS_POINTS } from "@/features/game/scoring";

export function Countdown({ deadline, serverTime, durationSeconds }: { deadline?: string; serverTime: string; durationSeconds: number }) {
  const offset = useMemo(() => new Date(serverTime).getTime() - Date.now(), [serverTime]);
  const [remaining, setRemaining] = useState(() => deadline ? Math.max(0, new Date(deadline).getTime() - (Date.now() + offset)) : 0);

  useEffect(() => {
    if (!deadline) return;
    const update = () => setRemaining(Math.max(0, new Date(deadline).getTime() - (Date.now() + offset)));
    update();
    const timer = window.setInterval(update, 50);
    return () => window.clearInterval(timer);
  }, [deadline, offset]);

  if (!deadline) {
    return <div aria-live="polite" className="rounded-2xl bg-white/8 px-4 py-2 text-center">
      <div className="text-lg font-black">Unlimited</div>
      <div className="text-xs font-bold text-cyan-300">{MAX_CORRECT_GUESS_POINTS} pts</div>
    </div>;
  }

  const seconds = Math.ceil(remaining / 1000);
  const urgent = seconds <= 5;
  const potentialPoints = calculateDisplayedPotentialPoints(remaining, durationSeconds);
  return <motion.div aria-live="polite" animate={urgent ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ duration: 0.55, repeat: urgent ? Infinity : 0 }} className={`min-w-24 rounded-2xl px-4 py-2 text-center tabular-nums ${urgent ? "bg-red-500/20 text-red-200" : "bg-white/8"}`}>
    <div className="text-2xl font-black">{seconds}s</div>
    <div className={`text-xs font-black ${urgent ? "text-red-200" : "text-cyan-300"}`}>{potentialPoints} pts</div>
  </motion.div>;
}

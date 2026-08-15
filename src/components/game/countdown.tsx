"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

export function Countdown({ deadline, serverTime }: { deadline?: string; serverTime: string }) {
  const offset = useMemo(() => new Date(serverTime).getTime() - Date.now(), [serverTime]);
  const [remaining, setRemaining] = useState(() => deadline ? Math.max(0, new Date(deadline).getTime() - (Date.now() + offset)) : 0);

  useEffect(() => {
    if (!deadline) return;
    const update = () => setRemaining(Math.max(0, new Date(deadline).getTime() - (Date.now() + offset)));
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [deadline, offset]);

  const seconds = Math.ceil(remaining / 1000);
  const urgent = seconds <= 5;
  return <motion.div aria-live="polite" animate={urgent ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ duration: 0.55, repeat: urgent ? Infinity : 0 }} className={`min-w-16 rounded-2xl px-4 py-2 text-center text-2xl font-black tabular-nums ${urgent ? "bg-red-500/20 text-red-200" : "bg-white/8"}`}>{seconds}s</motion.div>;
}

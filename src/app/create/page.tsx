"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/choice-grid";
import { ensureBrowserIdentity } from "@/lib/supabase/identity-browser";

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roundCount, setRoundCount] = useState<5 | 10 | 15 | 20>(10);
  const [timer, setTimer] = useState<0 | 30 | 45 | 60 | 90>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await ensureBrowserIdentity();
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, roundCount, guessDurationSeconds: timer, activityTypes: ["LIKE"] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create room.");
      router.push(`/room/${data.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create room.");
    } finally { setBusy(false); }
  }

  return <main className="shell py-8 sm:py-12"><div className="mx-auto max-w-xl">
    <Link href="/" className="text-sm font-bold text-zinc-400 hover:text-white">← Home</Link>
    <h1 className="mt-5 text-4xl font-black">Create game</h1>
    <form onSubmit={submit} className="panel mt-6 space-y-6 p-5 sm:p-7">
      <label className="block space-y-2"><span className="text-sm font-bold text-zinc-300">Your name</span><Input required maxLength={30} placeholder="James" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></label>
      <ChoiceGrid label="Rounds" values={[5,10,15,20] as const} value={roundCount} onChange={setRoundCount} />
      <fieldset className="space-y-2"><legend className="text-sm font-bold text-zinc-300">Guess timer</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{([30,45,60,90,0] as const).map((seconds) => <button key={seconds} type="button" onClick={() => setTimer(seconds)} aria-pressed={timer === seconds} className={`focus-ring min-h-12 rounded-xl border px-2 font-bold ${timer === seconds ? "border-cyan-300 bg-cyan-300 text-black" : "border-white/10 bg-white/5 text-white"}`}>{seconds === 0 ? "Unlimited" : `${seconds}s`}</button>)}</div>
        <p className="text-xs text-zinc-500">30 seconds minimum. Unlimited rounds end when everyone guesses or a majority votes to end early.</p>
      </fieldset>
      <fieldset className="space-y-2"><legend className="text-sm font-bold text-zinc-300">Sources</legend>
        <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-cyan-300/50 bg-cyan-300/10 px-4"><input type="checkbox" checked readOnly /> <span className="font-bold">Likes</span></label>
        <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/8 bg-white/3 px-4 text-zinc-500"><input type="checkbox" disabled /> <span><strong>Reposts</strong> <span className="text-xs">Coming soon</span></span></label>
      </fieldset>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      <Button className="w-full" disabled={busy}>{busy ? "Creating…" : "Create game"}</Button>
    </form>
  </div></main>;
}

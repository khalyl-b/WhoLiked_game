"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureBrowserIdentity } from "@/lib/supabase/identity-browser";

export default function JoinPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await ensureBrowserIdentity();
      const normalised = code.trim().toUpperCase();
      const response = await fetch(`/api/rooms/${encodeURIComponent(normalised)}/join`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not join room.");
      router.push(`/room/${data.code}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join room."); }
    finally { setBusy(false); }
  }

  return <main className="shell py-8 sm:py-12"><div className="mx-auto max-w-xl">
    <Link href="/" className="text-sm font-bold text-zinc-400 hover:text-white">← Home</Link>
    <h1 className="mt-5 text-4xl font-black">Join game</h1>
    <form onSubmit={submit} className="panel mt-6 space-y-5 p-5 sm:p-7">
      <label className="block space-y-2"><span className="text-sm font-bold text-zinc-300">Your name</span><Input required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed" /></label>
      <label className="block space-y-2"><span className="text-sm font-bold text-zinc-300">Room code</span><Input required minLength={6} maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} placeholder="K7BXQ2" className="text-center text-2xl font-black tracking-[0.25em] uppercase" autoCapitalize="characters" /></label>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      <Button className="w-full" disabled={busy}>{busy ? "Joining…" : "Join game"}</Button>
    </form>
  </div></main>;
}

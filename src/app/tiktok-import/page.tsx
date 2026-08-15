"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ensureBrowserIdentity } from "@/lib/supabase/identity-browser";

export default function TikTokImportConsentPage() {
  const [portabilityAvailable, setPortabilityAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/auth/tiktok/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { portabilityAvailable?: boolean }) => setPortabilityAvailable(payload.portabilityAvailable === true))
      .catch(() => setPortabilityAvailable(false));
  }, []);

  async function proceed() {
    await ensureBrowserIdentity();
    window.location.assign("/api/auth/tiktok/portability");
  }

  return <main className="shell py-10 sm:py-14"><section className="mx-auto max-w-2xl">
    <Link href="/account" className="text-sm font-bold text-zinc-400 hover:text-white">← Account</Link>
    <div className="panel mt-5 p-6 sm:p-8">
      <p className="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">TikTok data import</p>
      <h1 className="mt-3 text-3xl font-black sm:text-4xl">Import your TikTok likes</h1>
      <p className="mt-4 leading-7 text-zinc-300">TikTok currently places the Like List inside its full data archive. To import likes through the official Data Portability API, TikTok therefore asks you to authorise a one-time full-archive transfer.</p>

      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h2 className="font-black">What TikTok may transfer</h2><p className="mt-2 text-sm leading-6 text-zinc-400">The one-time <code>portability.all.single</code> export may contain profile/settings, activity, posts and other archive categories supported by TikTok.</p></div>
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-4"><h2 className="font-black text-emerald-200">What this game keeps</h2><p className="mt-2 text-sm leading-6 text-zinc-300">The importer extracts only your Like List for gameplay: TikTok video URLs/identifiers and the like date where present. The downloaded ZIP is processed transiently and is not intentionally stored as a raw archive.</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h2 className="font-black">Why we need it</h2><p className="mt-2 text-sm leading-6 text-zinc-400">The game needs a pool of your liked TikToks so it can privately select individual videos for friends to guess. Other players do not receive your complete Like List.</p></div>
      </div>

      <p className="mt-6 text-sm leading-6 text-zinc-400">You can delete imported TikTok data at any time from <Link href="/account" className="underline text-zinc-200">Account</Link>. See the <Link href="/privacy" className="underline text-zinc-200">Privacy Policy</Link> for details.</p>
      {portabilityAvailable === false && <p className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100">Official Data Portability import is waiting for TikTok approval. Use the manual archive importer on the Account page for now.</p>}
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <Button disabled={portabilityAvailable !== true} onClick={() => void proceed()}>{portabilityAvailable === null ? "Checking availability…" : portabilityAvailable ? "Proceed to TikTok" : "Awaiting TikTok approval"}</Button>
        <Link href="/account" className="focus-ring rounded-2xl border border-white/10 bg-white/7 px-5 py-3 text-center font-black hover:bg-white/12">Go back</Link>
      </div>
    </div>
  </section></main>;
}

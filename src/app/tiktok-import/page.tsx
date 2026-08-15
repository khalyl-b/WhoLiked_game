"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ensureBrowserIdentity } from "@/lib/supabase/identity-browser";

export default function TikTokImportConsentPage() {
  const [portabilityAvailable, setPortabilityAvailable] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/auth/tiktok/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { portabilityAvailable?: boolean }) => setPortabilityAvailable(payload.portabilityAvailable === true))
      .catch(() => setPortabilityAvailable(false));
  }, []);

  async function proceed() {
    setNotice("");
    if (portabilityAvailable !== true) {
      setNotice("This final authorisation step will become active once TikTok approves the Data Portability scope for Who Liked. No request has been sent to TikTok.");
      return;
    }
    await ensureBrowserIdentity();
    window.location.assign("/api/auth/tiktok/portability");
  }

  return <main className="shell py-10 sm:py-14">
    <section className="mx-auto max-w-2xl">
      <Link href="/account" className="text-sm font-bold text-zinc-400 hover:text-white">← Account</Link>
      <div className="panel mt-5 p-6 sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">One-time TikTok transfer</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">Import your TikTok likes</h1>
        <p className="mt-4 leading-7 text-zinc-300">
          Who Liked needs a one-time transfer of your TikTok data to build your private gameplay activity pool. You stay in control and can go back without sharing anything.
        </p>

        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="font-black">What TikTok will prepare</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">TikTok places the Like List inside its full data archive, so the one-time transfer may contain additional archive categories supported by TikTok.</p>
          </div>
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-4">
            <h2 className="font-black text-emerald-200">What Who Liked keeps</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">Only your Like List entries needed for gameplay: TikTok video URLs/identifiers and the like date where present. The downloaded archive is processed transiently and is not intentionally stored as a raw archive.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="font-black">Why the game needs it</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Your imported likes form a private pool from which individual videos can be selected for guessing rounds. Other players never receive your complete Like List.</p>
          </div>
        </div>

        <p className="mt-6 text-sm leading-6 text-zinc-400">
          You can delete imported TikTok data at any time from <Link href="/account" className="underline text-zinc-200">Account</Link>. See the <Link href="/privacy" className="underline text-zinc-200">Privacy Policy</Link> for details.
        </p>

        {portabilityAvailable === false && <p className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100">TikTok has not approved the Data Portability scope yet. This page shows the exact consent step that will be used after approval; pressing Proceed now will not send a request.</p>}
        {notice && <p role="status" className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm leading-6 text-cyan-100">{notice}</p>}

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link href="/account" className="focus-ring rounded-2xl border border-white/10 bg-white/7 px-5 py-3 text-center font-black hover:bg-white/12">Go back</Link>
          <Button disabled={portabilityAvailable === null} onClick={() => void proceed()}>
            {portabilityAvailable === null ? "Checking availability…" : "Proceed to TikTok"}
          </Button>
        </div>
      </div>
    </section>
  </main>;
}

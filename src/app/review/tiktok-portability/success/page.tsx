import Link from "next/link";

export default function TikTokPortabilitySuccessMock() {
  return <main className="shell py-8 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <Link href="/review/tiktok-portability" className="text-sm font-bold text-zinc-400 hover:text-white">← Review guide</Link>
      <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-cyan-300">TikTok review mock · Screen 4</p>
      <h1 className="mt-2 text-4xl font-black">Account & TikTok</h1>
      <p className="mt-3 text-zinc-400">Your authorised TikTok Like List has been imported and is ready for private game rounds.</p>

      <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">TikTok import complete. 143 unique likes were imported successfully.</p>

      <section className="panel mt-6 p-5 sm:p-7">
        <h2 className="text-xl font-black">1. TikTok connection</h2>
        <div className="mt-4 flex items-center gap-4">
          <div aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xl font-black">K</div>
          <div><p className="font-black">K</p><p className="text-sm text-emerald-300">Connected</p></div>
        </div>
      </section>

      <section className="panel mt-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-xl font-black">2. Likes readiness</h2><p className="mt-1 text-sm text-zinc-400">Only imported Like List records are counted for gameplay.</p></div>
          <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-sm font-black text-emerald-300">143 likes · Ready</div>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-4">
          <h3 className="font-black text-emerald-200">Official Data Portability import complete</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">Who Liked extracted only the TikTok Like List needed for gameplay. The raw archive is not retained, and your complete Like List is never sent to other players.</p>
          <div className="mt-4 inline-flex min-h-12 items-center rounded-2xl bg-white px-5 py-3 font-bold text-black">Ready to play</div>
        </div>
      </section>

      <section className="panel mt-5 p-5 sm:p-7">
        <h2 className="text-xl font-black">Privacy controls</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">You can disconnect TikTok or permanently delete your imported TikTok data at any time.</p>
      </section>
    </div>
  </main>;
}

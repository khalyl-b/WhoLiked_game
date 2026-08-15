import Link from "next/link";

export default function TikTokPortabilityConnectionMock() {
  return <main className="shell py-8 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <Link href="/review/tiktok-portability" className="text-sm font-bold text-zinc-400 hover:text-white">← Review guide</Link>
      <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-cyan-300">TikTok review mock · Screen 1</p>
      <h1 className="mt-2 text-4xl font-black">Account & TikTok</h1>
      <p className="mt-3 text-zinc-400">Connect your TikTok identity, then import only the activity needed for the game.</p>

      <section className="panel mt-6 p-5 sm:p-7">
        <h2 className="text-xl font-black">1. TikTok connection</h2>
        <div className="mt-4">
          <p className="text-zinc-300">Connect using TikTok&apos;s official Login Kit.</p>
          <div className="mt-5 inline-flex min-h-12 items-center rounded-2xl bg-white px-5 py-3 font-bold text-black">Connect TikTok</div>
        </div>
      </section>

      <section className="panel mt-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-xl font-black">2. Likes readiness</h2><p className="mt-1 text-sm text-zinc-400">Connect TikTok before importing your Like List.</p></div>
          <div className="rounded-full bg-amber-300/10 px-3 py-1 text-sm font-black text-amber-200">0 likes · Not ready</div>
        </div>
      </section>
    </div>
  </main>;
}

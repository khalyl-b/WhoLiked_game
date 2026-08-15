import Link from "next/link";

export default function Home() {
  return <main className="shell flex min-h-screen items-center py-12">
    <section className="mx-auto w-full max-w-xl text-center">
      <div className="mb-6 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-zinc-300">Private party game</div>
      <h1 className="text-balance text-5xl font-black tracking-tight sm:text-7xl">Who liked <span className="text-cyan-300">that</span>?</h1>
      <p className="mx-auto mt-5 max-w-md text-lg leading-8 text-zinc-300">Guess your friends from their TikTok likes. One video, one owner, one chance to expose the group chat.</p>
      <div className="mt-9 grid gap-3 sm:grid-cols-2">
        <Link className="focus-ring rounded-2xl bg-white px-6 py-4 text-lg font-black text-black hover:bg-zinc-200" href="/create">Create game</Link>
        <Link className="focus-ring rounded-2xl border border-white/10 bg-white/7 px-6 py-4 text-lg font-black hover:bg-white/12" href="/join">Join game</Link>
      </div>
      <p className="mt-6 text-sm text-zinc-500">Development mode uses realistic fake activity. TikTok credentials are not required.</p><Link href="/account" className="focus-ring mt-4 inline-block rounded-lg px-2 py-1 text-sm font-bold text-zinc-500 hover:text-white">Account & TikTok connection</Link>
    </section>
  </main>;
}

import Link from "next/link";

const Screen = ({ step, title, children }: { step: string; title: string; children: React.ReactNode }) => (
  <section className="rounded-[2rem] border border-white/10 bg-[#111118] p-5 shadow-2xl sm:p-6">
    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">{step}</p>
    <h2 className="mt-2 text-2xl font-black">{title}</h2>
    <div className="mt-5">{children}</div>
  </section>
);

export default function TikTokPortabilityReviewPage() {
  return <main className="shell py-10 sm:py-14">
    <div className="mx-auto max-w-6xl">
      <Link href="/account" className="text-sm font-bold text-zinc-400 hover:text-white">← Account</Link>
      <div className="mt-5 max-w-3xl">
        <p className="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">Review material</p>
        <h1 className="mt-2 text-4xl font-black sm:text-5xl">TikTok Data Portability UX</h1>
        <p className="mt-4 leading-7 text-zinc-400">These screens document the intended end-to-end user journey for TikTok review. Capture screens 1, 2 and 4 from this site. For screen 3, use the real TikTok-hosted authorisation page produced by the working Login Kit flow.</p>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Screen step="Screen 1" title="Connect to TikTok">
          <div className="rounded-2xl border border-white/8 bg-white/5 p-5">
            <p className="font-black">TikTok connection</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Connect your TikTok identity so Who Liked That? can associate an authorised likes import with your account.</p>
            <div className="mt-5 rounded-2xl bg-white px-5 py-3 text-center font-black text-black">Connect TikTok</div>
          </div>
        </Screen>

        <Screen step="Screen 2" title="Explain the transfer before proceeding">
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4"><p className="font-black">What TikTok may transfer</p><p className="mt-2 text-sm leading-6 text-zinc-400">TikTok places the Like List in the full archive, so the one-time transfer may contain additional archive categories.</p></div>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-4"><p className="font-black text-emerald-200">What the game keeps</p><p className="mt-2 text-sm leading-6 text-zinc-300">Only Like List video URLs/identifiers and like dates where available. The raw archive is processed transiently.</p></div>
            <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white px-4 py-3 text-center font-black text-black">Proceed to TikTok</div><div className="rounded-2xl border border-white/10 px-4 py-3 text-center font-black">Go back</div></div>
          </div>
        </Screen>

        <Screen step="Screen 3" title="TikTok-hosted authorisation">
          <div className="rounded-2xl border border-dashed border-white/20 bg-white/3 p-8 text-center">
            <p className="font-black">Use a real screenshot here</p>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Start the Data Portability authorisation flow and capture TikTok's own permission page. Do not replace TikTok's page with this placeholder in the review upload.</p>
          </div>
        </Screen>

        <Screen step="Screen 4" title="Import complete and ready to play">
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">Likes readiness</p><p className="mt-1 text-sm text-zinc-400">Only imported Like List records are counted.</p></div><div className="rounded-full bg-emerald-400/15 px-3 py-1 text-sm font-black text-emerald-300">143 likes · Ready</div></div>
            <p className="mt-5 text-sm leading-6 text-zinc-300">Your TikTok likes are ready for private guessing rounds. Your complete Like List is not sent to other players.</p>
            <div className="mt-5 rounded-2xl bg-white px-5 py-3 text-center font-black text-black">Back to account</div>
          </div>
        </Screen>
      </div>

      <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm leading-6 text-amber-100">
        This route is review documentation only. The live user flow is <code>/account → /tiktok-import → TikTok → /account</code>.
      </div>
    </div>
  </main>;
}

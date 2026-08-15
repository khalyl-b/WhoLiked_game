import Link from "next/link";
import type { ReactNode } from "react";

const Screen = ({ step, title, children }: { step: string; title: string; children: ReactNode }) => (
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
        <p className="mt-4 leading-7 text-zinc-400">Use the full-screen links below for TikTok&apos;s required PDF. Screen 2 is also the real live consent page used by the approved flow. For Screen 3, use the genuine TikTok-hosted authorisation page from your Sandbox flow.</p>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Screen step="Screen 1" title="TikTok connection page">
          <p className="text-sm leading-6 text-zinc-400">Shows the user choosing to connect TikTok with Login Kit before any portability request.</p>
          <Link href="/review/tiktok-portability/connect" className="focus-ring mt-5 inline-block rounded-2xl bg-white px-5 py-3 font-black text-black">Open full-screen Screen 1</Link>
        </Screen>

        <Screen step="Screen 2" title="Connecting to TikTok / data-transfer explanation">
          <p className="text-sm leading-6 text-zinc-400">The actual pre-transfer consent screen explains what TikTok may transfer, what Who Liked keeps, why it is needed, and gives both Go back and Proceed to TikTok controls.</p>
          <Link href="/tiktok-import" className="focus-ring mt-5 inline-block rounded-2xl bg-white px-5 py-3 font-black text-black">Open actual Screen 2</Link>
        </Screen>

        <Screen step="Screen 3" title="TikTok-hosted authorisation">
          <div className="rounded-2xl border border-dashed border-white/20 bg-white/3 p-5">
            <p className="font-black">Use your real TikTok screenshot</p>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Use the genuine TikTok permission page with Cancel and Continue. Do not replace it with a mock.</p>
          </div>
        </Screen>

        <Screen step="Screen 4" title="Final output / successful import">
          <p className="text-sm leading-6 text-zinc-400">A high-fidelity post-approval result showing a successful import and sufficient likes for gameplay.</p>
          <Link href="/review/tiktok-portability/success" className="focus-ring mt-5 inline-block rounded-2xl bg-white px-5 py-3 font-black text-black">Open full-screen Screen 4</Link>
        </Screen>
      </div>

      <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm leading-6 text-amber-100">
        Screens 1 and 4 are review mockups of the intended approved experience. Screen 2 is the real product consent page. Screen 3 must be TikTok&apos;s real hosted authorisation page.
      </div>
    </div>
  </main>;
}

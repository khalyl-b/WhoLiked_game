import Link from "next/link";

export function SiteFooter() {
  return <footer className="border-t border-white/8 bg-black/10">
    <div className="shell flex flex-col gap-3 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
      <p>Who Liked That? · Social party game</p>
      <nav aria-label="Legal and account" className="flex flex-wrap gap-x-5 gap-y-2">
        <Link className="focus-ring rounded hover:text-white" href="/account">Account & TikTok</Link>
        <Link className="focus-ring rounded hover:text-white" href="/privacy">Privacy</Link>
        <Link className="focus-ring rounded hover:text-white" href="/terms">Terms</Link>
      </nav>
    </div>
  </footer>;
}

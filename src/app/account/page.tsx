"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ensureBrowserIdentity } from "@/lib/supabase/identity-browser";

type Status = { connected: boolean; displayName?: string; avatarUrl?: string; scopes?: string[]; connectedAt?: string };

export default function AccountPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch("/api/auth/tiktok/status", { cache: "no-store" }); setStatus(await response.json()); }
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    const connected = new URLSearchParams(window.location.search).get("connected");
    if (error) setMessage(error === "tiktok_not_configured" ? "TikTok credentials are not configured for this environment." : "TikTok connection could not be completed.");
    else if (connected) setMessage("TikTok connected successfully.");
    void load();
  }, []);
  async function connectTikTok() { await ensureBrowserIdentity(); window.location.assign("/api/auth/tiktok/start"); }
  async function disconnect() { await fetch("/api/auth/tiktok/disconnect", { method: "POST" }); await load(); }
  async function deleteSocialData() { if (!window.confirm("Delete imported TikTok activity and disconnect TikTok?")) return; await fetch("/api/account/delete-social-data", { method: "POST" }); setMessage("Imported TikTok data deleted."); await load(); }
  return <main className="shell py-8 sm:py-12"><div className="mx-auto max-w-xl">
    <Link href="/" className="text-sm font-bold text-zinc-400 hover:text-white">← Home</Link>
    <h1 className="mt-5 text-4xl font-black">Account</h1>
    <section className="panel mt-6 p-5 sm:p-7"><h2 className="text-xl font-black">TikTok connection</h2>{message && <p role="status" className="mt-4 rounded-xl bg-white/6 px-4 py-3 text-sm text-zinc-200">{message}</p>}
      {!status ? <p className="mt-4 text-zinc-400">Checking connection…</p> : status.connected ? <div className="mt-4"><div className="flex items-center gap-4"><div aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xl font-black">{status.displayName?.slice(0, 1).toUpperCase() ?? "T"}</div><div><p className="font-black">{status.displayName}</p><p className="text-sm text-emerald-300">Connected</p></div></div><Button variant="danger" className="mt-5" onClick={() => void disconnect()}>Disconnect TikTok</Button></div> : <div className="mt-4"><p className="text-zinc-300">Connect your TikTok profile using the official Login Kit flow.</p><Button className="mt-5" onClick={() => void connectTikTok()}>Connect TikTok</Button></div>}
      <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/8 p-4 text-sm leading-6 text-amber-100"><strong>Current MVP data source:</strong> game rounds still use the fake provider. Connecting TikTok does not pretend to grant ordinary app access to your like/repost history.</div>
    <div className="mt-4"><Button variant="secondary" onClick={() => void deleteSocialData()}>Delete imported TikTok data</Button></div>
    </section>
  </div></main>;
}

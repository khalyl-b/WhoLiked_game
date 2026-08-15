"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ensureBrowserIdentity } from "@/lib/supabase/identity-browser";
import { parseTikTokArchiveFile } from "@/features/social/tiktok-archive";

type ConnectionStatus = { connected: boolean; displayName?: string; avatarUrl?: string; scopes?: string[]; connectedAt?: string; portabilityAvailable?: boolean };
type PortabilityRequest = { status: string; requestId: string; errorMessage?: string; createdAt: string; readyAt?: string; importedAt?: string };
type ActivityStatus = { likes: number; request: PortabilityRequest | null; error?: string };

export default function AccountPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [activity, setActivity] = useState<ActivityStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadActivity() {
    const activityResponse = await fetch("/api/tiktok/portability/status", { cache: "no-store" });
    setActivity(await activityResponse.json());
  }

  async function load() {
    const [connectionResponse, activityResponse] = await Promise.all([
      fetch("/api/auth/tiktok/status", { cache: "no-store" }),
      fetch("/api/tiktok/portability/status", { cache: "no-store" }),
    ]);
    setStatus(await connectionResponse.json());
    setActivity(await activityResponse.json());
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const connected = params.get("connected");
    const portability = params.get("portability");
    if (error === "tiktok_not_configured") setMessage("TikTok credentials are not configured for this environment.");
    else if (error === "portability_scope_not_granted") setMessage("TikTok did not grant the Data Portability permission. This feature is still awaiting TikTok approval.");
    else if (error === "portability_not_enabled") setMessage("Official TikTok likes import is disabled until TikTok approves the Data Portability scope for this app.");
    else if (error) setMessage("TikTok connection could not be completed.");
    else if (portability === "requested") setMessage("TikTok accepted your data request. It may take seconds, minutes or longer to prepare.");
    else if (connected) setMessage("TikTok connected successfully.");
    void ensureBrowserIdentity().then(load).catch((identityError) => {
      console.error(identityError);
      setMessage("Could not create your browser session. Refresh and try again.");
    });
  }, []);

  useEffect(() => {
    if (!activity?.request || !["pending", "downloading"].includes(activity.request.status)) return;
    const timer = window.setInterval(() => void loadActivity(), 10_000);
    return () => window.clearInterval(timer);
  }, [activity?.request?.status]);

  async function connectTikTok() {
    await ensureBrowserIdentity();
    window.location.assign("/api/auth/tiktok/start");
  }


  async function disconnect() {
    setBusy("disconnect");
    try {
      await fetch("/api/auth/tiktok/disconnect", { method: "POST" });
      setMessage("TikTok disconnected. Imported activity is retained until you delete it.");
      await load();
    } finally { setBusy(null); }
  }

  async function downloadReadyData() {
    setBusy("download"); setMessage("");
    try {
      const response = await fetch("/api/tiktok/portability/download", { method: "POST" });
      const payload = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Import failed.");
      setMessage(`Imported ${payload.imported ?? 0} TikTok likes.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(null); }
  }

  async function importManualArchive(file: File) {
    setBusy("manual"); setMessage("Reading your TikTok archive locally in this browser…");
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Archive is larger than 100 MB. Export or select the Like List JSON/TXT file instead.");
      const items = await parseTikTokArchiveFile(file);
      if (items.length === 0) throw new Error("No TikTok Like List entries were found in that file.");
      let imported = 0;
      for (let start = 0; start < items.length; start += 500) {
        const response = await fetch("/api/tiktok/manual-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.slice(start, start + 500) }),
        });
        const payload = await response.json() as { total?: number; error?: string };
        if (!response.ok) throw new Error(payload.error || "Manual import failed.");
        imported += payload.total ?? 0;
        setMessage(`Importing likes… ${Math.min(start + 500, items.length)} / ${items.length}`);
      }
      setMessage(`Imported ${imported} unique TikTok likes. The full archive stayed in your browser; only extracted like records were uploaded.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Manual import failed."); }
    finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteSocialData() {
    if (!window.confirm("Delete all imported TikTok activity and disconnect TikTok? This cannot be undone.")) return;
    setBusy("delete");
    try {
      const response = await fetch("/api/account/delete-social-data", { method: "POST" });
      if (!response.ok) throw new Error("Could not delete TikTok data.");
      setMessage("Imported TikTok data and the stored TikTok connection were deleted.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Deletion failed."); }
    finally { setBusy(null); }
  }

  const likes = activity?.likes ?? 0;
  const ready = likes >= 10;
  const portabilityApproved = status?.scopes?.some((scope: string) => scope === "portability.all.single" || scope === "portability.all.ongoing") ?? false;
  const portabilityAvailable = status?.portabilityAvailable ?? false;
  const requestStatus = activity?.request?.status;

  return <main className="shell py-8 sm:py-12"><div className="mx-auto max-w-2xl">
    <Link href="/" className="text-sm font-bold text-zinc-400 hover:text-white">← Home</Link>
    <h1 className="mt-5 text-4xl font-black">Account & TikTok</h1>
    <p className="mt-3 text-zinc-400">Connect your TikTok identity, then import only the activity needed for the game.</p>

    {message && <p role="status" className="mt-5 rounded-xl border border-white/8 bg-white/6 px-4 py-3 text-sm text-zinc-200">{message}</p>}

    <section className="panel mt-6 p-5 sm:p-7">
      <h2 className="text-xl font-black">1. TikTok connection</h2>
      {!status ? <p className="mt-4 text-zinc-400">Checking connection…</p> : status.connected ? <div className="mt-4">
        <div className="flex items-center gap-4">
          <div aria-hidden className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xl font-black">{status.displayName?.slice(0, 1).toUpperCase() ?? "T"}</div>
          <div><p className="font-black">{status.displayName}</p><p className="text-sm text-emerald-300">Connected</p></div>
        </div>
        <Button variant="secondary" className="mt-5" disabled={busy !== null} onClick={() => void disconnect()}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect TikTok"}</Button>
      </div> : <div className="mt-4"><p className="text-zinc-300">Connect using TikTok's official Login Kit.</p><Button className="mt-5" onClick={() => void connectTikTok()}>Connect TikTok</Button></div>}
    </section>

    <section className="panel mt-5 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-black">2. Likes readiness</h2><p className="mt-1 text-sm text-zinc-400">At least 10 eligible likes are recommended.</p></div><div className={`rounded-full px-3 py-1 text-sm font-black ${ready ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-300/10 text-amber-200"}`}>{likes} likes · {ready ? "Ready" : "Not ready"}</div></div>

      <div className="mt-5 rounded-2xl border border-white/8 bg-white/4 p-4">
        <h3 className="font-black">Official Data Portability import</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">This requests a one-time TikTok data export and extracts the Like List. It only works after TikTok approves the Data Portability scope for this app.</p>
        {!status?.connected ? <p className="mt-3 text-sm text-amber-200">Connect TikTok first.</p> : requestStatus === "pending" ? <p className="mt-3 text-sm text-cyan-200">TikTok is preparing your data. This page checks periodically.</p> : requestStatus === "downloading" ? <div><Button className="mt-4" disabled={busy !== null} onClick={() => void downloadReadyData()}>{busy === "download" ? "Importing…" : "Import ready TikTok data"}</Button>{activity?.request?.errorMessage && <p className="mt-3 text-sm text-rose-300">Last attempt: {activity.request.errorMessage}</p>}</div> : requestStatus === "importing" ? <p className="mt-3 text-sm text-cyan-200">Import is in progress…</p> : requestStatus === "failed" && portabilityAvailable ? <div className="mt-3"><p className="text-sm text-rose-300">Last import failed: {activity?.request?.errorMessage || "Unknown error"}</p><Link href="/tiktok-import" className="focus-ring mt-3 inline-block rounded-xl bg-white px-4 py-2 font-black text-black">Authorise a new import</Link></div> : portabilityAvailable ? <Link href="/tiktok-import" className="focus-ring mt-4 inline-block rounded-xl bg-white px-4 py-3 font-black text-black">{portabilityApproved ? "Request TikTok data" : "Authorise TikTok likes import"}</Link> : <div className="mt-4"><div className="flex flex-wrap items-center gap-3"><Button disabled>Awaiting TikTok approval</Button><Link href="/tiktok-import" className="focus-ring inline-block rounded-xl border border-white/10 bg-white/7 px-4 py-3 font-black text-white hover:bg-white/12">View import consent</Link></div><p className="mt-2 text-xs leading-5 text-zinc-500">Official import will unlock after TikTok approves the Data Portability scope. You can review the exact consent step now or use the manual archive importer below.</p></div>}
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-white/4 p-4">
        <h3 className="font-black">Manual archive fallback</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">While API approval is pending, upload your own TikTok data ZIP/JSON. The archive is parsed locally in your browser and only extracted liked-video records are sent to the server.</p>
        <input ref={fileRef} className="mt-4 block w-full text-sm text-zinc-300 file:mr-3 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2 file:font-black file:text-black" type="file" accept=".zip,.json,.txt,application/zip,application/json,text/plain" disabled={busy !== null} onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void importManualArchive(file); }} />
      </div>
    </section>

    <section className="panel mt-5 p-5 sm:p-7">
      <h2 className="text-xl font-black">Privacy controls</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Delete all imported TikTok activity, portability request records and the stored TikTok connection.</p>
      <Button variant="danger" className="mt-4" disabled={busy !== null} onClick={() => void deleteSocialData()}>{busy === "delete" ? "Deleting…" : "Delete my TikTok data"}</Button>
      <div className="mt-4 flex gap-4 text-sm text-zinc-500"><Link className="underline hover:text-white" href="/privacy">Privacy Policy</Link><Link className="underline hover:text-white" href="/terms">Terms</Link></div>
    </section>
  </div></main>;
}

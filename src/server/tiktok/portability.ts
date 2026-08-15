import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normaliseTikTokUrl, parseTikTokArchiveBytes, stableTikTokVideoId, type ParsedTikTokLike } from "@/features/social/tiktok-archive";
import { getValidTikTokAccessToken } from "./oauth";

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const STATUS_FIELDS = "request_id,status,apply_time,collect_time,data_format,category_selection_list";

export type PortabilityStatus = "pending" | "downloading" | "importing" | "completed" | "expired" | "cancelled" | "failed";

export interface PortabilityRequestRecord {
  id: string;
  userId: string;
  requestId: string;
  status: PortabilityStatus;
  dataFormat: "json" | "text";
  categorySelectionList: string[];
  applyTime?: string;
  collectTime?: string;
  readyAt?: string;
  importedAt?: string;
  lastCheckedAt?: string;
  errorMessage?: string;
  createdAt: string;
}

function db() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("Supabase is not configured.");
  return client;
}

function isoFromEpoch(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}


function validatedRequestId(requestId: string) {
  const value = requestId.trim();
  if (!/^[1-9]\d{0,18}$/.test(value)) throw new Error("TikTok returned an unsupported request identifier.");
  return value;
}

function requestIdBody(requestId: string) {
  // TikTok defines request_id as int64. Keep it as an opaque decimal string in
  // JavaScript/SQL, then emit the JSON number ourselves so IDs above JS's safe
  // integer range cannot be rounded before they reach TikTok.
  return `{"request_id":${validatedRequestId(requestId)}}`;
}

function requestIdFromResponseBody(rawBody: string): string | null {
  const match = rawBody.match(/"request_id"\s*:\s*"?([1-9]\d{0,18})"?/);
  return match?.[1] ?? null;
}

export function normalisePortabilityStatus(remoteStatus: string): PortabilityStatus {
  if (remoteStatus === "pending" || remoteStatus === "downloading" || remoteStatus === "expired" || remoteStatus === "cancelled") {
    return remoteStatus;
  }
  throw new Error(`TikTok returned an unsupported portability status: ${remoteStatus}`);
}

export function normaliseImportedTikTokItems(items: ParsedTikTokLike[]): ParsedTikTokLike[] {
  const normalised = items.flatMap((item) => {
    const videoUrl = normaliseTikTokUrl(item.videoUrl);
    if (!videoUrl) return [];
    let activityDate: string | undefined;
    if (item.activityDate) {
      const parsed = new Date(item.activityDate);
      if (!Number.isNaN(parsed.getTime())) activityDate = parsed.toISOString();
    }
    // Never trust a client-supplied video ID. Derive it from the validated TikTok URL.
    return [{ videoId: stableTikTokVideoId(videoUrl), videoUrl, activityDate } satisfies ParsedTikTokLike];
  });
  return [...new Map(normalised.map((item) => [item.videoId, item])).values()];
}

function apiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: string; code?: string } }).error;
    if (error?.message) return new Error(`${fallback}: ${error.message}`);
    if (error?.code && error.code !== "ok") return new Error(`${fallback}: ${error.code}`);
  }
  return new Error(fallback);
}

function mapRow(row: Record<string, unknown>): PortabilityRequestRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    requestId: String(row.request_id),
    status: row.status as PortabilityStatus,
    dataFormat: (row.data_format as "json" | "text") ?? "json",
    categorySelectionList: (row.category_selection_list as string[]) ?? ["all_data"],
    applyTime: row.apply_time ? String(row.apply_time) : undefined,
    collectTime: row.collect_time ? String(row.collect_time) : undefined,
    readyAt: row.ready_at ? String(row.ready_at) : undefined,
    importedAt: row.imported_at ? String(row.imported_at) : undefined,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at),
  };
}

export async function latestPortabilityRequest(userId: string): Promise<PortabilityRequestRecord | null> {
  const { data, error } = await db()
    .from("tiktok_portability_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function createPortabilityRequest(userId: string): Promise<PortabilityRequestRecord> {
  const existing = await latestPortabilityRequest(userId);
  if (existing && ["pending", "downloading", "importing"].includes(existing.status)) return existing;

  const { connection, accessToken } = await getValidTikTokAccessToken(userId);
  if (!connection.scopes.includes("portability.all.single") && !connection.scopes.includes("portability.all.ongoing")) {
    throw new Error("TikTok Data Portability permission has not been granted.");
  }

  const response = await fetch("https://open.tiktokapis.com/v2/user/data/add/?fields=request_id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data_format: "json", category_selection_list: ["all_data"] }),
    cache: "no-store",
  });
  const rawPayload = await response.text();
  let payload: { error?: { code?: string; message?: string } } = {};
  try { payload = JSON.parse(rawPayload) as typeof payload; } catch { /* handled below */ }
  const requestId = requestIdFromResponseBody(rawPayload);
  if (!response.ok || payload.error?.code !== "ok" || !requestId) throw apiError(payload, "TikTok data request failed");

  const { data, error } = await db().from("tiktok_portability_requests").insert({
    user_id: userId,
    request_id: requestId,
    status: "pending",
    data_format: "json",
    category_selection_list: ["all_data"],
  }).select("*").single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function refreshPortabilityStatus(userId: string): Promise<PortabilityRequestRecord | null> {
  const record = await latestPortabilityRequest(userId);
  if (!record || ["completed", "expired", "cancelled", "failed"].includes(record.status)) return record;
  if (record.status === "importing") return record;

  const { accessToken } = await getValidTikTokAccessToken(userId);
  const response = await fetch(`https://open.tiktokapis.com/v2/user/data/check/?fields=${STATUS_FIELDS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: requestIdBody(record.requestId),
    cache: "no-store",
  });
  const payload = await response.json() as {
    data?: { status?: string; apply_time?: number; collect_time?: number; data_format?: string; category_selection_list?: string[] };
    error?: { code?: string; message?: string };
  };
  if (!response.ok || payload.error?.code !== "ok" || !payload.data?.status) throw apiError(payload, "TikTok data request status failed");

  const status = normalisePortabilityStatus(payload.data.status);
  const now = new Date().toISOString();
  const { data, error } = await db().from("tiktok_portability_requests").update({
    status,
    apply_time: isoFromEpoch(payload.data.apply_time),
    collect_time: isoFromEpoch(payload.data.collect_time),
    ready_at: status === "downloading" ? (record.readyAt ?? now) : record.readyAt ?? null,
    last_checked_at: now,
    updated_at: now,
  }).eq("id", record.id).select("*").single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

async function readResponseWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > limit) throw new Error("TikTok archive is too large for automatic import. Use the manual archive import instead.");
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("TikTok archive is too large for automatic import. Use the manual archive import instead.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
}

export async function importTikTokItems(userId: string, items: ParsedTikTokLike[], source: "portability_api" | "manual_archive") {
  const unique = normaliseImportedTikTokItems(items);
  if (unique.length === 0) throw new Error("No valid TikTok liked-video URLs were supplied.");

  const database = db();
  const { data: existingUser, error: userLookupError } = await database.from("users").select("id").eq("id", userId).maybeSingle();
  if (userLookupError) throw userLookupError;
  if (!existingUser) {
    const { error: userInsertError } = await database.from("users").insert({ id: userId, auth_user_id: userId, display_name: "Player" });
    if (userInsertError) throw userInsertError;
  }

  let imported = 0;
  for (let start = 0; start < unique.length; start += 500) {
    const batch = unique.slice(start, start + 500).map((item) => ({
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      activityDate: item.activityDate ?? null,
      activityType: "LIKE",
    }));
    const { data, error } = await database.rpc("import_tiktok_activity", { p_user_id: userId, p_items: batch, p_import_source: source });
    if (error) throw error;
    imported += Number(data ?? batch.length);
  }
  return { imported, total: unique.length };
}

export async function downloadAndImportPortabilityRequest(userId: string) {
  const record = await refreshPortabilityStatus(userId);
  if (!record) throw new Error("No TikTok data request exists.");
  if (record.status === "completed") return { imported: 0, alreadyCompleted: true };
  if (record.status !== "downloading") throw new Error("TikTok is still preparing your data.");

  const now = new Date().toISOString();
  const { data: claimed, error: lockError } = await db().from("tiktok_portability_requests")
    .update({ status: "importing", updated_at: now, error_message: null })
    .eq("id", record.id).eq("status", "downloading")
    .select("id").maybeSingle();
  if (lockError) throw lockError;
  if (!claimed) {
    const latest = await latestPortabilityRequest(userId);
    if (latest?.status === "completed") return { imported: 0, alreadyCompleted: true };
    throw new Error("This TikTok import is already being processed. Refresh in a moment.");
  }

  try {
    const { accessToken } = await getValidTikTokAccessToken(userId);
    const response = await fetch("https://open.tiktokapis.com/v2/user/data/download/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: requestIdBody(record.requestId),
      cache: "no-store",
    });
    if (!response.ok) {
      let payload: unknown = null;
      try { payload = await response.json(); } catch { /* binary/empty response */ }
      throw apiError(payload, "TikTok data download failed");
    }
    const archive = await readResponseWithLimit(response, MAX_ARCHIVE_BYTES);
    const likes = await parseTikTokArchiveBytes(archive);
    if (likes.length === 0) throw new Error("TikTok archive was downloaded, but no Like List entries could be found.");
    const result = await importTikTokItems(userId, likes, "portability_api");
    await db().from("tiktok_portability_requests").update({
      status: "completed", imported_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      metadata: { importedLikes: result.total }, error_message: null,
    }).eq("id", record.id);
    return { imported: result.total, alreadyCompleted: false };
  } catch (error) {
    await db().from("tiktok_portability_requests").update({
      status: "downloading", error_message: error instanceof Error ? error.message : "Import failed", updated_at: new Date().toISOString(),
    }).eq("id", record.id);
    throw error;
  }
}

export async function markPortabilityReady(requestId: string) {
  const now = new Date().toISOString();
  const { error } = await db().from("tiktok_portability_requests").update({ status: "downloading", ready_at: now, updated_at: now }).eq("request_id", requestId);
  if (error) throw error;
}


export async function cancelOutstandingPortabilityRequest(userId: string, accessToken?: string) {
  const record = await latestPortabilityRequest(userId);
  if (!record || !["pending", "downloading"].includes(record.status)) return;
  if (accessToken) {
    try {
      await fetch("https://open.tiktokapis.com/v2/user/data/cancel/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: requestIdBody(record.requestId),
        cache: "no-store",
      });
    } catch (error) {
      console.warn("TikTok portability cancellation could not be confirmed", error);
    }
  }
  await db().from("tiktok_portability_requests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", record.id);
}

export async function deleteTikTokUserData(userId: string) {
  const { error } = await db().rpc("delete_tiktok_user_data", { p_user_id: userId });
  if (error) throw error;
}

export async function activitySummary(userId: string) {
  const { count: likes, error } = await db().from("social_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("provider", "TIKTOK").eq("activity_type", "LIKE").eq("available", true)
    .neq("import_source", "fixture");
  if (error) throw error;
  return { likes: likes ?? 0 };
}

export function verifyTikTokWebhookSignature(rawBody: string, header: string | null) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const timestamp = parts.t;
  const signature = parts.s;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!timestamp || !signature || !secret) return false;
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || Math.abs(Date.now() / 1000 - numericTimestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
}

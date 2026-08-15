import JSZip from "jszip";

export interface ParsedTikTokLike {
  videoId: string;
  videoUrl: string;
  activityDate?: string;
}

const TIKTOK_URL_RE = /https?:\/\/(?:[A-Za-z0-9-]+\.)?(?:tiktok\.com|tiktokv\.com)\/[A-Za-z0-9_@?&=./%-]+/gi;
const VIDEO_ID_RE = /\/video\/(\d{6,})/i;

function normaliseKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLikeSectionKey(key: string) {
  const k = normaliseKey(key);
  return k === "likelist" || k === "likedvideos";
}

function isDedicatedLikeFileName(fileName: string) {
  const base = fileName.split("/").pop()?.replace(/\.(json|txt)$/i, "") ?? "";
  const key = normaliseKey(base);
  return key === "likelist" || key === "likedvideos" || key === "likes" || key === "likehistory";
}

function firstStringByKey(value: unknown, wanted: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const wantedSet = new Set(wanted.map(normaliseKey));
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (wantedSet.has(normaliseKey(key)) && typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

export function stableTikTokVideoId(url: string) {
  const match = url.match(VIDEO_ID_RE);
  if (match?.[1]) return match[1];
  return `url:${url.toLowerCase().replace(/[?#].*$/, "")}`;
}

export function normaliseTikTokUrl(raw: string): string | null {
  const cleaned = raw.trim();
  if (!cleaned || cleaned.length > 2048) return null;
  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    const isTikTokHost = host === "tiktok.com" || host.endsWith(".tiktok.com");
    const isTikTokExportHost = host === "tiktokv.com" || host.endsWith(".tiktokv.com");
    if (!isTikTokHost && !isTikTokExportHost) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function addRecord(target: Map<string, ParsedTikTokLike>, rawUrl: string, rawDate?: string) {
  const videoUrl = normaliseTikTokUrl(rawUrl);
  if (!videoUrl) return;
  const videoId = stableTikTokVideoId(videoUrl);
  let activityDate: string | undefined;
  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) activityDate = parsed.toISOString();
  }
  const existing = target.get(videoId);
  if (!existing || (!existing.activityDate && activityDate)) target.set(videoId, { videoId, videoUrl, activityDate });
}

function extractFromLikeNode(node: unknown, target: Map<string, ParsedTikTokLike>) {
  if (Array.isArray(node)) {
    for (const item of node) extractFromLikeNode(item, target);
    return;
  }
  if (!node || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const url = firstStringByKey(record, [
    "Video landing page link", "Video Link", "Link", "Video URL", "VideoUrl", "shareUrl", "share_url",
  ]);
  const date = firstStringByKey(record, ["Date", "Time", "Create Time", "Activity Date", "date"]);
  if (url) addRecord(target, url, date);

  for (const value of Object.values(record)) {
    if (typeof value === "object" && value) extractFromLikeNode(value, target);
  }
}

function walkJson(value: unknown, target: Map<string, ParsedTikTokLike>) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, target);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isLikeSectionKey(key)) extractFromLikeNode(child, target);
    else walkJson(child, target);
  }
}

export function parseTikTokJson(value: unknown): ParsedTikTokLike[] {
  const target = new Map<string, ParsedTikTokLike>();
  walkJson(value, target);
  return [...target.values()];
}

export function parseTikTokLikeJsonValue(value: unknown): ParsedTikTokLike[] {
  const target = new Map<string, ParsedTikTokLike>();
  extractFromLikeNode(value, target);
  return [...target.values()];
}

export function parseTikTokLikeText(text: string): ParsedTikTokLike[] {
  const target = new Map<string, ParsedTikTokLike>();
  const lower = text.toLowerCase();
  const looksLikeLikeFile = lower.includes("like list") || lower.includes("liked video");
  if (!looksLikeLikeFile) return [];
  const urls = text.match(TIKTOK_URL_RE) ?? [];
  for (const url of urls) addRecord(target, url);
  return [...target.values()];
}

export async function parseTikTokArchiveBytes(bytes: ArrayBuffer | Uint8Array): Promise<ParsedTikTokLike[]> {
  const zip = await JSZip.loadAsync(bytes);
  const target = new Map<string, ParsedTikTokLike>();

  for (const fileName of Object.keys(zip.files)) {
    const entry = zip.files[fileName];
    if (!entry || entry.dir) continue;
    const name = entry.name.toLowerCase();
    if (!name.endsWith(".json") && !name.endsWith(".txt")) continue;
    const body = await entry.async("string");
    if (name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        // Prefer section-aware traversal even when the file name contains "like".
        // A combined "Likes and Favourites" file can also contain Favourite
        // Videos, which are not equivalent to the user's Like List. Only fall
        // back to treating the whole JSON value as likes for a dedicated Like
        // List file whose root is commonly an array.
        const sectionItems = parseTikTokJson(parsed);
        const items = sectionItems.length > 0
          ? sectionItems
          : isDedicatedLikeFileName(name)
            ? parseTikTokLikeJsonValue(parsed)
            : [];
        for (const item of items) target.set(item.videoId, item);
      } catch {
        // A malformed/unrelated JSON entry should not invalidate the entire archive.
      }
    } else if (isDedicatedLikeFileName(name)) {
      for (const item of parseTikTokLikeText(body)) target.set(item.videoId, item);
    }
  }

  return [...target.values()];
}

export async function parseTikTokArchiveFile(file: File): Promise<ParsedTikTokLike[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".zip")) return parseTikTokArchiveBytes(await file.arrayBuffer());
  const text = await file.text();
  if (lower.endsWith(".json")) {
    const parsed = JSON.parse(text);
    const sectionItems = parseTikTokJson(parsed);
    if (sectionItems.length > 0) return sectionItems;
    return isDedicatedLikeFileName(lower) ? parseTikTokLikeJsonValue(parsed) : [];
  }
  return isDedicatedLikeFileName(lower) ? parseTikTokLikeText(text) : [];
}

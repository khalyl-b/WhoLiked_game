import type { SocialActivity } from "@/features/game/types";

export type TikTokAvailability = "available" | "unavailable";

const CHECK_TIMEOUT_MS = 4_000;

/**
 * Checks a public TikTok post through TikTok's official oEmbed endpoint before
 * the game exposes it to players. A definitive 4xx means the post cannot be
 * embedded. Transient/network failures throw instead of guessing, so a game
 * never deliberately starts with an unverified video.
 */
export async function checkTikTokVideoAvailability(activity: SocialActivity): Promise<TikTokAvailability> {
  if (activity.videoId.startsWith("fake-")) return "available";
  if (!/^\d{6,19}$/.test(activity.videoId)) return "unavailable";

  // Data Portability exports currently use tiktokv.com share links. TikTok's
  // oEmbed API accepts a video URL, but we also try a post-ID URL so a change
  // in share-link handling does not create false "unavailable" results.
  const candidateUrls = [...new Set([
    activity.videoUrl,
    `https://www.tiktok.com/@/video/${activity.videoId}`,
  ])];

  let sawDefinitiveUnavailable = false;
  for (const videoUrl of candidateUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const endpoint = new URL("https://www.tiktok.com/oembed");
      endpoint.searchParams.set("url", videoUrl);
      const response = await fetch(endpoint, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        const payload = await response.json().catch(() => null) as { provider_name?: string; type?: string; html?: string } | null;
        if (payload && payload.provider_name === "TikTok" && typeof payload.html === "string") return "available";
        sawDefinitiveUnavailable = true;
        continue;
      }

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        sawDefinitiveUnavailable = true;
        continue;
      }
      throw new Error(`TikTok availability check returned HTTP ${response.status}.`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("TikTok availability check timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return sawDefinitiveUnavailable ? "unavailable" : "unavailable";
}

export async function checkTikTokVideosWithConcurrency(
  activities: SocialActivity[],
  concurrency = 8,
): Promise<Map<string, TikTokAvailability>> {
  const unique = [...new Map(activities.map((activity) => [activity.videoId, activity])).values()];
  const results = new Map<string, TikTokAvailability>();
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= unique.length) return;
      const activity = unique[index];
      results.set(activity.videoId, await checkTikTokVideoAvailability(activity));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
  return results;
}

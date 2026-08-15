import { afterEach, describe, expect, it, vi } from "vitest";
import { checkTikTokVideoAvailability } from "@/server/social/tiktok-video-availability";
import type { SocialActivity } from "@/features/game/types";

const activity: SocialActivity = {
  id: "activity-1",
  userId: "11111111-1111-4111-8111-111111111111",
  source: "TIKTOK",
  activityType: "LIKE",
  videoId: "7346461277755116842",
  videoUrl: "https://www.tiktokv.com/share/video/7346461277755116842/",
  importedAt: "2026-08-15T12:00:00.000Z",
  available: true,
};

afterEach(() => vi.unstubAllGlobals());

describe("TikTok video availability", () => {
  it("accepts an embeddable TikTok returned by oEmbed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      provider_name: "TikTok",
      type: "video",
      html: "<blockquote></blockquote>",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(checkTikTokVideoAvailability(activity)).resolves.toBe("available");
  });

  it("rejects a video when TikTok definitively rejects both URL forms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(checkTikTokVideoAvailability(activity)).resolves.toBe("unavailable");
  });

  it("does not guess when TikTok has a transient server failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("temporary", { status: 503 })));
    await expect(checkTikTokVideoAvailability(activity)).rejects.toThrow(/HTTP 503/);
  });
});

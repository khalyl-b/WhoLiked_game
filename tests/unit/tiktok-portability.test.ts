import { afterEach, describe, expect, it } from "vitest";
import { FakeTikTokProvider } from "@/providers/social/fake-tiktok-provider";
import { TikTokProvider } from "@/providers/social/tiktok-provider";
import { createSocialActivityProvider } from "@/providers/social/provider-factory";
import { normaliseImportedTikTokItems, normalisePortabilityStatus } from "@/server/tiktok/portability";

const originalProvider = process.env.SOCIAL_ACTIVITY_PROVIDER;
afterEach(() => {
  if (originalProvider === undefined) delete process.env.SOCIAL_ACTIVITY_PROVIDER;
  else process.env.SOCIAL_ACTIVITY_PROVIDER = originalProvider;
});

describe("TikTok portability helpers", () => {
  it("maps only documented remote request states", () => {
    expect(normalisePortabilityStatus("pending")).toBe("pending");
    expect(normalisePortabilityStatus("downloading")).toBe("downloading");
    expect(normalisePortabilityStatus("expired")).toBe("expired");
    expect(normalisePortabilityStatus("cancelled")).toBe("cancelled");
    expect(() => normalisePortabilityStatus("mystery")).toThrow(/unsupported portability status/i);
  });

  it("derives trusted video IDs from validated TikTok URLs and deduplicates them", () => {
    const items = normaliseImportedTikTokItems([
      { videoId: "attacker-controlled", videoUrl: "https://www.tiktok.com/@one/video/7400000000000000123", activityDate: "2026-08-01T10:00:00Z" },
      { videoId: "different-client-id", videoUrl: "https://www.tiktok.com/@two/video/7400000000000000123?lang=en" },
      { videoId: "bad", videoUrl: "https://example.com/video/7400000000000000999" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].videoId).toBe("7400000000000000123");
    expect(items[0].videoUrl).toContain("tiktok.com");
  });

  it("switches the game provider without changing the game engine interface", () => {
    process.env.SOCIAL_ACTIVITY_PROVIDER = "fake";
    expect(createSocialActivityProvider()).toBeInstanceOf(FakeTikTokProvider);
    process.env.SOCIAL_ACTIVITY_PROVIDER = "tiktok";
    expect(createSocialActivityProvider()).toBeInstanceOf(TikTokProvider);
  });
});

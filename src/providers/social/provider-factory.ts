import type { SocialActivityProvider } from "./social-activity-provider";
import { FakeTikTokProvider } from "./fake-tiktok-provider";
import { TikTokProvider } from "./tiktok-provider";

export function createSocialActivityProvider(): SocialActivityProvider {
  const mode = (process.env.SOCIAL_ACTIVITY_PROVIDER ?? "fake").toLowerCase();
  if (mode === "fake") return new FakeTikTokProvider();
  if (mode === "tiktok") return new TikTokProvider();
  throw new Error(`Unsupported SOCIAL_ACTIVITY_PROVIDER value: ${mode}`);
}

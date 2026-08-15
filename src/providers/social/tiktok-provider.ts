import type { SocialActivity } from "@/features/game/types";
import type { SocialActivityProvider } from "./social-activity-provider";

export class TikTokProvider implements SocialActivityProvider {
  async getLikes(_userId: string): Promise<SocialActivity[]> {
    throw new Error("TikTok activity access is not configured. Use FakeTikTokProvider until approved API access is available.");
  }

  async getReposts(_userId: string): Promise<SocialActivity[]> {
    throw new Error("TikTok repost access is not enabled by this application.");
  }
}

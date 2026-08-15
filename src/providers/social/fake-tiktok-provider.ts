import type { SocialActivity } from "@/features/game/types";
import type { SocialActivityProvider } from "./social-activity-provider";

const CREATORS = ["streetfoodlab", "tinybuilds", "footballclips", "catcommittee", "sciencebits", "travelminute", "chefnextdoor", "retroarchive"];
const TITLES = [
  "The crispiest chips in town",
  "This build should not work, but it does",
  "Sunday league finish of the year",
  "Cat refuses to respect personal space",
  "A physics trick you can try safely",
  "Hidden place worth the train ride",
  "One-pan dinner in 15 minutes",
  "Internet nostalgia unlocked",
];

function hash(input: string) {
  let value = 2166136261;
  for (const char of input) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return Math.abs(value >>> 0);
}

function makeActivity(userId: string, index: number, activityType: "LIKE" | "REPOST"): SocialActivity {
  const seed = hash(`${userId}:${index}:${activityType}`);
  const videoId = `fake-${seed.toString(36)}-${index}`;
  return {
    id: `${activityType.toLowerCase()}-${userId}-${index}`,
    userId,
    source: "TIKTOK",
    activityType,
    videoId,
    videoUrl: `https://www.tiktok.com/@${CREATORS[seed % CREATORS.length]}/video/${1000000000000000000n + BigInt(seed + index)}`,
    title: TITLES[seed % TITLES.length],
    creator: `@${CREATORS[seed % CREATORS.length]}`,
    importedAt: new Date(1700000000000 + index * 86_400_000).toISOString(),
    available: index !== 22,
  };
}

export class FakeTikTokProvider implements SocialActivityProvider {
  async getLikes(userId: string): Promise<SocialActivity[]> {
    const unique = Array.from({ length: 24 }, (_, index) => makeActivity(userId, index, "LIKE"));
    const shared: SocialActivity = {
      ...makeActivity(userId, 90, "LIKE"),
      id: `shared-like-${userId}`,
      videoId: "fake-shared-room-duplicate",
      videoUrl: "https://www.tiktok.com/@shared/video/9999999999999999999",
      title: "Everyone somehow liked this one",
      creator: "@shared",
    };
    return [...unique, shared];
  }

  async getReposts(userId: string): Promise<SocialActivity[]> {
    return Array.from({ length: 8 }, (_, index) => makeActivity(userId, index, "REPOST"));
  }
}

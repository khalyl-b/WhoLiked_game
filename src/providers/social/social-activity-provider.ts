import type { SocialActivity } from "@/features/game/types";

export interface SocialActivityProvider {
  getLikes(userId: string): Promise<SocialActivity[]>;
  getReposts(userId: string): Promise<SocialActivity[]>;
}

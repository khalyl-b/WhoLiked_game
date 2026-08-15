import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SocialActivity } from "@/features/game/types";
import type { SocialActivityProvider } from "./social-activity-provider";

interface ActivityRow {
  id: string;
  user_id: string;
  activity_type: "LIKE" | "REPOST";
  video_id: string;
  video_url: string;
  activity_date: string | null;
  imported_at: string;
  available: boolean;
  metadata: Record<string, unknown> | null;
}

export class TikTokProvider implements SocialActivityProvider {
  private async get(userId: string, activityType: "LIKE" | "REPOST"): Promise<SocialActivity[]> {
    const db = createSupabaseAdminClient();
    if (!db) throw new Error("Supabase is required for imported TikTok activity.");
    const { data, error } = await db.from("social_activity")
      .select("id,user_id,activity_type,video_id,video_url,activity_date,imported_at,available,metadata")
      .eq("user_id", userId).eq("provider", "TIKTOK").eq("activity_type", activityType)
      .neq("import_source", "fixture");
    if (error) throw error;
    return ((data ?? []) as ActivityRow[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      source: "TIKTOK" as const,
      activityType: row.activity_type,
      videoId: row.video_id,
      videoUrl: row.video_url,
      activityDate: row.activity_date ?? undefined,
      importedAt: row.imported_at,
      available: row.available,
      title: typeof row.metadata?.title === "string" ? row.metadata.title : undefined,
      creator: typeof row.metadata?.creator === "string" ? row.metadata.creator : undefined,
      thumbnailUrl: typeof row.metadata?.thumbnailUrl === "string" ? row.metadata.thumbnailUrl : undefined,
    }));
  }

  getLikes(userId: string) { return this.get(userId, "LIKE"); }
  getReposts(userId: string) { return this.get(userId, "REPOST"); }
}

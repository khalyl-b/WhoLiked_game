import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { activitySummary, latestPortabilityRequest, refreshPortabilityStatus } from "@/server/tiktok/portability";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ connected: false, likes: 0, request: null });
  try {
    const existing = await latestPortabilityRequest(userId);
    let request = existing;
    if (existing && ["pending", "downloading"].includes(existing.status)) {
      try { request = await refreshPortabilityStatus(userId); } catch (error) { console.warn("Portability status refresh failed", error); }
    }
    const activity = await activitySummary(userId);
    return NextResponse.json({ likes: activity.likes, request });
  } catch (error) {
    console.error("Portability status failed", error);
    return NextResponse.json({ error: "Could not load TikTok activity status." }, { status: 500 });
  }
}

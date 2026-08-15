import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { importTikTokItems } from "@/server/tiktok/portability";
import type { ParsedTikTokLike } from "@/features/social/tiktok-archive";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "SESSION_REQUIRED" }, { status: 401 });
  try {
    const body = await request.json() as { items?: ParsedTikTokLike[] };
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 1000) {
      return NextResponse.json({ error: "Send between 1 and 1000 parsed likes per batch." }, { status: 400 });
    }
    const result = await importTikTokItems(userId, body.items, "manual_archive");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Manual TikTok import failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manual import failed." }, { status: 400 });
  }
}

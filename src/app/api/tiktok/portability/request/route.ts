import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { createPortabilityRequest } from "@/server/tiktok/portability";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "SESSION_REQUIRED" }, { status: 401 });
  try {
    const request = await createPortabilityRequest(userId);
    return NextResponse.json({ ok: true, request });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not request TikTok data." }, { status: 400 });
  }
}

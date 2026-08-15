import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { downloadAndImportPortabilityRequest } from "@/server/tiktok/portability";

export const maxDuration = 300;

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "SESSION_REQUIRED" }, { status: 401 });
  try {
    const result = await downloadAndImportPortabilityRequest(userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("TikTok portability import failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "TikTok import failed." }, { status: 400 });
  }
}

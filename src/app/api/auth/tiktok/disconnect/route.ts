import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { deleteTikTokConnection, getTikTokConnection, getValidTikTokAccessToken, revokeTikTokAccess } from "@/server/tiktok/oauth";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ ok: true });
  if (await getTikTokConnection(userId)) {
    try {
      const { accessToken } = await getValidTikTokAccessToken(userId);
      await revokeTikTokAccess(accessToken);
    } catch (error) {
      console.warn("TikTok revoke could not be confirmed; clearing local connection", error);
    } finally {
      await deleteTikTokConnection(userId);
    }
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { getGameEngine } from "@/server/game/game-runtime";
import { deleteTikTokConnection, getTikTokConnection, getValidTikTokAccessToken, revokeTikTokAccess } from "@/server/tiktok/oauth";

export async function POST() {
  const userId = await getSessionUserId();
  if (userId) {
    if (await getTikTokConnection(userId)) {
      try { const { accessToken } = await getValidTikTokAccessToken(userId); await revokeTikTokAccess(accessToken); }
      catch (error) { console.warn("TikTok revoke could not be confirmed during data deletion", error); }
      finally { await deleteTikTokConnection(userId); }
    }
    await getGameEngine().deleteUserSocialActivity(userId);
  }
  return NextResponse.json({ ok: true });
}

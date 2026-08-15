import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { deleteTikTokConnection, getTikTokConnection, getValidTikTokAccessToken, revokeTikTokAccess } from "@/server/tiktok/oauth";
import { deleteTikTokUserData } from "@/server/tiktok/portability";
import { hasSupabaseServerConfig } from "@/lib/supabase/config";
import { getGameEngine } from "@/server/game/game-runtime";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ ok: true });

  if (await getTikTokConnection(userId)) {
    try {
      const { accessToken } = await getValidTikTokAccessToken(userId);
      await revokeTikTokAccess(accessToken);
    } catch (error) {
      console.warn("TikTok revoke could not be confirmed during data deletion", error);
    }
  }

  if (hasSupabaseServerConfig()) {
    await deleteTikTokUserData(userId);
  } else {
    await getGameEngine().deleteUserSocialActivity(userId);
    await deleteTikTokConnection(userId);
  }
  return NextResponse.json({ ok: true });
}

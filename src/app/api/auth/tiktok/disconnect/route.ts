import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { deleteTikTokConnection, getTikTokConnection, getValidTikTokAccessToken, revokeTikTokAccess } from "@/server/tiktok/oauth";
import { cancelOutstandingPortabilityRequest } from "@/server/tiktok/portability";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ ok: true });
  if (await getTikTokConnection(userId)) {
    try {
      const valid = await getValidTikTokAccessToken(userId);
      await cancelOutstandingPortabilityRequest(userId, valid.accessToken);
      await revokeTikTokAccess(valid.accessToken);
    } catch (error) {
      console.warn("TikTok revoke/cancellation could not be confirmed; clearing local connection", error);
      await cancelOutstandingPortabilityRequest(userId).catch(() => undefined);
    } finally {
      await deleteTikTokConnection(userId);
    }
  }
  return NextResponse.json({ ok: true });
}

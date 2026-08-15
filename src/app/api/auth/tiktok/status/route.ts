import { NextResponse } from "next/server";
import { getSessionUserId } from "@/server/session/session";
import { deleteTikTokConnection, fetchTikTokProfile, getTikTokConnection, getValidTikTokAccessToken, saveTikTokConnection } from "@/server/tiktok/oauth";

export async function GET() {
  const portabilityAvailable = process.env.TIKTOK_PORTABILITY_ENABLED === "true";
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ connected: false, portabilityAvailable });
  const connection = await getTikTokConnection(userId);
  if (!connection) return NextResponse.json({ connected: false, portabilityAvailable });
  try {
    const valid = await getValidTikTokAccessToken(userId);
    const profile = await fetchTikTokProfile(valid.accessToken);
    const refreshed = { ...valid.connection, displayName: profile.display_name || valid.connection.displayName, avatarUrl: profile.avatar_url || valid.connection.avatarUrl };
    await saveTikTokConnection(refreshed);
    return NextResponse.json({ connected: true, displayName: refreshed.displayName, avatarUrl: refreshed.avatarUrl, scopes: refreshed.scopes, connectedAt: refreshed.connectedAt, portabilityAvailable });
  } catch (error) {
    console.warn("TikTok connection no longer valid", error);
    await deleteTikTokConnection(userId);
    return NextResponse.json({ connected: false, reason: "revoked_or_expired", portabilityAvailable });
  }
}

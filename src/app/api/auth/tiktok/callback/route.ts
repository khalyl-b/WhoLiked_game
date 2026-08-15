import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUserId } from "@/server/session/session";
import { encryptSecret, exchangeCode, fetchTikTokProfile, saveTikTokConnection } from "@/server/tiktok/oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const jar = await cookies();
  const stored = jar.get("tiktok_oauth_state")?.value;
  jar.delete("tiktok_oauth_state");
  const userId = await getSessionUserId();
  if (oauthError) return NextResponse.redirect(new URL(`/account?error=${encodeURIComponent(oauthError)}`, request.url));
  if (!userId || !code || !state || stored !== `${userId}:${state}`) return NextResponse.redirect(new URL("/account?error=invalid_oauth_state", request.url));
  try {
    const token = await exchangeCode(code);
    const profile = await fetchTikTokProfile(token.access_token);
    const now = Date.now();
    await saveTikTokConnection({
      userId,
      openId: token.open_id,
      displayName: profile.display_name || "TikTok user",
      avatarUrl: profile.avatar_url,
      scopes: token.scope.split(",").filter(Boolean),
      connectedAt: new Date(now).toISOString(),
      accessTokenEncrypted: encryptSecret(token.access_token),
      refreshTokenEncrypted: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: new Date(now + token.expires_in * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(now + token.refresh_expires_in * 1000).toISOString(),
    });
    return NextResponse.redirect(new URL("/account?connected=1", request.url));
  } catch (error) {
    console.error("TikTok OAuth callback failed", error);
    return NextResponse.redirect(new URL("/account?error=tiktok_callback_failed", request.url));
  }
}

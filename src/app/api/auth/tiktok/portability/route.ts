import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureSessionUserId } from "@/server/session/session";

export async function GET(request: Request) {
  const userId = await ensureSessionUserId();
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !redirectUri) return NextResponse.redirect(new URL("/account?error=tiktok_not_configured", request.url));
  const state = crypto.randomBytes(30).toString("base64url");
  const jar = await cookies();
  jar.set("tiktok_oauth_state", `${userId}:portability:${state}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user.info.basic,portability.all.single");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}

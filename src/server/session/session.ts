import crypto from "node:crypto";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GameError } from "@/server/game/errors";
import { hasSupabasePublicConfig, hasSupabaseServerConfig } from "@/lib/supabase/config";

const COOKIE_NAME = "tg_session";

function useSupabaseIdentity() {
  const configured = process.env.GAME_STORAGE?.toLowerCase();
  if (configured) return configured === "supabase";
  return hasSupabasePublicConfig() && hasSupabaseServerConfig();
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production.");
  return "development-only-change-me";
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

async function getLegacySessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [userId, signature] = raw.split(".");
  if (!userId || !signature) return null;
  const expected = sign(userId);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return userId;
}

export async function getSessionUserId(): Promise<string | null> {
  if (useSupabaseIdentity()) {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  }
  return getLegacySessionUserId();
}

export async function ensureSessionUserId(): Promise<string> {
  const existing = await getSessionUserId();
  if (existing) return existing;

  if (useSupabaseIdentity()) {
    throw new GameError(
      "SESSION_REQUIRED",
      "Your browser session is missing. Refresh the page and try again.",
      401,
    );
  }

  const userId = crypto.randomUUID();
  const jar = await cookies();
  jar.set(COOKIE_NAME, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return userId;
}

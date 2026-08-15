import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseServerConfig } from "@/lib/supabase/config";

export interface TikTokConnection {
  userId: string;
  openId: string;
  displayName: string;
  avatarUrl?: string;
  scopes: string[];
  connectedAt: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

interface SocialAccountRow {
  id: string;
  user_id: string;
  provider_user_id: string;
  provider_display_name: string | null;
  provider_avatar_url: string | null;
  connected_at: string;
}

interface TokenRow {
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scopes: string[] | null;
}

declare global {
  var __tiktokConnections: Map<string, TikTokConnection> | undefined;
}

function connections() {
  globalThis.__tiktokConnections ??= new Map<string, TikTokConnection>();
  return globalThis.__tiktokConnections;
}

function useSupabasePersistence() {
  const configured = process.env.GAME_STORAGE?.toLowerCase();
  if (configured) return configured === "supabase";
  return hasSupabaseServerConfig();
}

export function parseTikTokScopes(raw: string) {
  return raw.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);
}

function encryptionKey() {
  const secret = process.env.TIKTOK_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY or SESSION_SECRET is required for token encryption in production.");
  return crypto.createHash("sha256").update(secret || "development-only-change-me").digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(value: string) {
  const payload = Buffer.from(value, "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function getTikTokConnection(userId: string): Promise<TikTokConnection | null> {
  if (!useSupabasePersistence()) return connections().get(userId) ?? null;
  const db = createSupabaseAdminClient();
  if (!db) return null;

  const { data: accountData, error: accountError } = await db
    .from("social_accounts")
    .select("id,user_id,provider_user_id,provider_display_name,provider_avatar_url,connected_at")
    .eq("user_id", userId)
    .eq("provider", "TIKTOK")
    .maybeSingle();
  if (accountError) throw accountError;
  if (!accountData) return null;
  const account = accountData as unknown as SocialAccountRow;

  const { data: tokenData, error: tokenError } = await db.rpc("get_social_account_token", { p_social_account_id: account.id });
  if (tokenError) throw tokenError;
  const raw = Array.isArray(tokenData) ? tokenData[0] : tokenData;
  if (!raw) return null;
  const token = raw as unknown as TokenRow;
  if (!token.refresh_token_ciphertext || !token.access_token_expires_at || !token.refresh_token_expires_at) return null;

  return {
    userId: account.user_id,
    openId: account.provider_user_id,
    displayName: account.provider_display_name || "TikTok user",
    avatarUrl: account.provider_avatar_url || undefined,
    scopes: token.scopes ?? [],
    connectedAt: account.connected_at,
    accessTokenEncrypted: token.access_token_ciphertext,
    refreshTokenEncrypted: token.refresh_token_ciphertext,
    accessTokenExpiresAt: token.access_token_expires_at,
    refreshTokenExpiresAt: token.refresh_token_expires_at,
  };
}

export async function saveTikTokConnection(connection: TikTokConnection): Promise<void> {
  if (!useSupabasePersistence()) {
    connections().set(connection.userId, connection);
    return;
  }
  const db = createSupabaseAdminClient();
  if (!db) throw new Error("Supabase is not configured.");

  const { data: existingUser, error: existingUserError } = await db
    .from("users")
    .select("id")
    .eq("id", connection.userId)
    .maybeSingle();
  if (existingUserError) throw existingUserError;
  if (!existingUser) {
    const { error: userError } = await db.from("users").insert({
      id: connection.userId,
      auth_user_id: connection.userId,
      display_name: connection.displayName.slice(0, 30) || "TikTok user",
      avatar_url: connection.avatarUrl ?? null,
    });
    if (userError) throw userError;
  }

  const { data: accountData, error: accountError } = await db
    .from("social_accounts")
    .upsert({
      user_id: connection.userId,
      provider: "TIKTOK",
      provider_user_id: connection.openId,
      provider_display_name: connection.displayName,
      provider_avatar_url: connection.avatarUrl ?? null,
      connected_at: connection.connectedAt,
    }, { onConflict: "user_id,provider" })
    .select("id")
    .single();
  if (accountError) throw accountError;

  const accountId = (accountData as unknown as { id: string }).id;
  const { error: tokenError } = await db.rpc("upsert_social_account_token", {
    p_social_account_id: accountId,
    p_access_token_ciphertext: connection.accessTokenEncrypted,
    p_refresh_token_ciphertext: connection.refreshTokenEncrypted,
    p_access_token_expires_at: connection.accessTokenExpiresAt,
    p_refresh_token_expires_at: connection.refreshTokenExpiresAt,
    p_scopes: connection.scopes,
  });
  if (tokenError) throw tokenError;
}

export async function deleteTikTokConnection(userId: string): Promise<void> {
  if (!useSupabasePersistence()) {
    connections().delete(userId);
    return;
  }
  const db = createSupabaseAdminClient();
  if (!db) return;
  const { error } = await db.from("social_accounts").delete().eq("user_id", userId).eq("provider", "TIKTOK");
  if (error) throw error;
}

export async function exchangeCode(code: string) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) throw new Error("TikTok credentials are not configured.");
  const body = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body,
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string" || typeof data.open_id !== "string") {
    throw new Error(typeof data.error_description === "string" ? data.error_description : "TikTok token exchange failed.");
  }
  return data as {
    access_token: string; refresh_token: string; open_id: string; scope: string;
    expires_in: number; refresh_expires_in: number; token_type: string;
  };
}

export async function refreshTikTokAccess(connection: TikTokConnection) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) throw new Error("TikTok credentials are not configured.");
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: decryptSecret(connection.refreshTokenEncrypted),
  });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body,
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new Error(typeof data.error_description === "string" ? data.error_description : "TikTok token refresh failed.");
  }
  const now = Date.now();
  const updated: TikTokConnection = {
    ...connection,
    openId: typeof data.open_id === "string" ? data.open_id : connection.openId,
    scopes: typeof data.scope === "string" ? parseTikTokScopes(data.scope) : connection.scopes,
    accessTokenEncrypted: encryptSecret(data.access_token),
    refreshTokenEncrypted: encryptSecret(data.refresh_token),
    accessTokenExpiresAt: new Date(now + Number(data.expires_in ?? 86400) * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + Number(data.refresh_expires_in ?? 31536000) * 1000).toISOString(),
  };
  await saveTikTokConnection(updated);
  return { connection: updated, accessToken: data.access_token };
}

export async function getValidTikTokAccessToken(userId: string) {
  const connection = await getTikTokConnection(userId);
  if (!connection) throw new Error("TikTok is not connected.");
  if (new Date(connection.refreshTokenExpiresAt).getTime() <= Date.now()) {
    await deleteTikTokConnection(userId);
    throw new Error("TikTok authorisation has expired.");
  }
  if (new Date(connection.accessTokenExpiresAt).getTime() - Date.now() > 60_000) {
    return { connection, accessToken: decryptSecret(connection.accessTokenEncrypted) };
  }
  return refreshTikTokAccess(connection);
}

export async function fetchTikTokProfile(accessToken: string) {
  const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name", {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
  });
  const result = await response.json() as { data?: { user?: { open_id?: string; avatar_url?: string; display_name?: string } }; error?: { message?: string } };
  if (!response.ok || !result.data?.user?.open_id) throw new Error(result.error?.message || "TikTok profile request failed.");
  return result.data.user;
}

export async function revokeTikTokAccess(accessToken: string) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return;
  const body = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token: accessToken });
  await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
}

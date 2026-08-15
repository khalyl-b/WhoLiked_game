import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { markPortabilityReady, verifyTikTokWebhookSignature } from "@/server/tiktok/portability";

interface TikTokWebhookPayload {
  client_key?: string;
  event?: string;
  user_openid?: string;
  content?: string;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyTikTokWebhookSignature(rawBody, request.headers.get("tiktok-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: TikTokWebhookPayload;
  try { payload = JSON.parse(rawBody) as TikTokWebhookPayload; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!payload.client_key || payload.client_key !== process.env.TIKTOK_CLIENT_KEY) {
    return NextResponse.json({ error: "Wrong client key" }, { status: 400 });
  }

  try {
    if (payload.event === "portability.download.ready") {
      // request_id is an int64. Extract its decimal representation from the
      // serialized content instead of routing it through a JS Number.
      const requestId = payload.content?.match(/"request_id"\s*:\s*"?([1-9]\d{0,18})"?/)?.[1];
      if (requestId) await markPortabilityReady(requestId);
    }

    if (payload.event === "authorization.removed" && payload.user_openid) {
      const db = createSupabaseAdminClient();
      if (db) {
        const { data: account } = await db.from("social_accounts").select("user_id").eq("provider", "TIKTOK").eq("provider_user_id", payload.user_openid).maybeSingle();
        if (account?.user_id) await db.rpc("delete_tiktok_user_data", { p_user_id: account.user_id });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("TikTok webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

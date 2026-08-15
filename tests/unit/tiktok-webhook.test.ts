import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verifyTikTokWebhookSignature } from "@/server/tiktok/portability";

const originalSecret = process.env.TIKTOK_CLIENT_SECRET;
afterEach(() => { process.env.TIKTOK_CLIENT_SECRET = originalSecret; });

describe("TikTok webhook verification", () => {
  it("accepts a fresh valid HMAC and rejects a changed body", () => {
    process.env.TIKTOK_CLIENT_SECRET = "unit-test-secret";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ client_key: "abc", event: "portability.download.ready", content: "{}" });
    const signature = crypto.createHmac("sha256", "unit-test-secret").update(`${timestamp}.${body}`).digest("hex");
    const header = `t=${timestamp},s=${signature}`;
    expect(verifyTikTokWebhookSignature(body, header)).toBe(true);
    expect(verifyTikTokWebhookSignature(`${body} `, header)).toBe(false);
  });

  it("rejects stale signatures", () => {
    process.env.TIKTOK_CLIENT_SECRET = "unit-test-secret";
    const timestamp = Math.floor(Date.now() / 1000 - 601).toString();
    const body = "{}";
    const signature = crypto.createHmac("sha256", "unit-test-secret").update(`${timestamp}.${body}`).digest("hex");
    expect(verifyTikTokWebhookSignature(body, `t=${timestamp},s=${signature}`)).toBe(false);
  });
});

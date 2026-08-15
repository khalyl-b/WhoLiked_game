import { NextResponse } from "next/server";
import { getGameEngine } from "@/server/game/game-runtime";
import { jsonError } from "@/server/game/http";
import { ensureSessionUserId } from "@/server/session/session";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const body = await request.json() as { displayName?: string };
    const userId = await ensureSessionUserId();
    const room = await getGameEngine().joinRoom(code, userId, body.displayName ?? "");
    return NextResponse.json({ code: room.code });
  } catch (error) {
    return jsonError(error);
  }
}

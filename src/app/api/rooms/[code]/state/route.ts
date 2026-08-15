import { NextResponse } from "next/server";
import { getGameEngine } from "@/server/game/game-runtime";
import { jsonError } from "@/server/game/http";
import { getSessionUserId } from "@/server/session/session";
import { GameError } from "@/server/game/errors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const userId = await getSessionUserId();
    if (!userId) throw new GameError("NO_SESSION", "Join this room first.", 401);
    const { code } = await context.params;
    const state = await getGameEngine().getPublicState(code, userId);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

import { NextResponse } from "next/server";
import { getGameEngine } from "@/server/game/game-runtime";
import { jsonError } from "@/server/game/http";
import { getSessionUserId } from "@/server/session/session";
import { GameError } from "@/server/game/errors";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const userId = await getSessionUserId();
    if (!userId) throw new GameError("NO_SESSION", "Join this room first.", 401);
    const { code } = await context.params;
    const body = await request.json() as { guessedUserId?: string };
    if (!body.guessedUserId) throw new GameError("INVALID_GUESS", "Choose a player.");
    await getGameEngine().submitGuess(code, userId, body.guessedUserId);
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

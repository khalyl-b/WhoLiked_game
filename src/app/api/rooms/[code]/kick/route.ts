import { NextResponse } from "next/server";
import { getGameEngine } from "@/server/game/game-runtime";
import { jsonError } from "@/server/game/http";
import { getSessionUserId } from "@/server/session/session";
import { GameError } from "@/server/game/errors";
export async function POST(request: Request, context: { params: Promise<{ code: string }> }) { try { const userId = await getSessionUserId(); if (!userId) throw new GameError("NO_SESSION", "Join this room first.", 401); const { code } = await context.params; const body = await request.json() as { targetUserId?: string }; if (!body.targetUserId) throw new GameError("INVALID_TARGET", "Choose a player."); await getGameEngine().kickPlayer(code, userId, body.targetUserId); return NextResponse.json({ ok: true }); } catch (error) { return jsonError(error); } }

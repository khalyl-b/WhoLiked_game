import { NextResponse } from "next/server";
import type { ActivityType, RoomSettings } from "@/features/game/types";
import { getGameEngine } from "@/server/game/game-runtime";
import { jsonError } from "@/server/game/http";
import { ensureSessionUserId } from "@/server/session/session";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      displayName?: string;
      roundCount?: number;
      guessDurationSeconds?: number;
      activityTypes?: ActivityType[];
    };
    const userId = await ensureSessionUserId();
    const settings: RoomSettings = {
      roundCount: body.roundCount as RoomSettings["roundCount"],
      guessDurationSeconds: body.guessDurationSeconds as RoomSettings["guessDurationSeconds"],
      activityTypes: body.activityTypes ?? ["LIKE"],
    };
    const room = await getGameEngine().createRoom(userId, body.displayName ?? "", settings);
    return NextResponse.json({ code: room.code }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

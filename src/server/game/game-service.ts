import type { PublicRoomState, Room, RoomSettings } from "@/features/game/types";

export interface GameService {
  createRoom(userId: string, displayName: string, settings: RoomSettings): Promise<Room>;
  joinRoom(code: string, userId: string, displayName: string): Promise<Room>;
  getPublicState(code: string, viewerUserId: string): Promise<PublicRoomState>;
  startGame(code: string, actorUserId: string): Promise<void>;
  submitGuess(code: string, actorUserId: string, guessedUserId: string): Promise<unknown>;
  skipRound(code: string, actorUserId: string): Promise<void>;
  endGame(code: string, actorUserId: string): Promise<void>;
  createRematch(code: string, actorUserId: string): Promise<Room | void>;
  leaveRoom(code: string, actorUserId: string): Promise<void>;
  kickPlayer(code: string, actorUserId: string, targetUserId: string): Promise<void>;
  deleteUserSocialActivity(userId: string): Promise<void>;
}

export type ActivityType = "LIKE" | "REPOST";
export type RoomStatus = "LOBBY" | "ACTIVE" | "FINISHED" | "CANCELLED";
export type RoundStatus = "PENDING" | "ACTIVE" | "REVEAL" | "FINISHED" | "SKIPPED";

export interface AppUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialActivity {
  id: string;
  userId: string;
  source: "TIKTOK";
  activityType: ActivityType;
  videoId: string;
  videoUrl: string;
  title?: string;
  creator?: string;
  thumbnailUrl?: string;
  activityDate?: string;
  importedAt: string;
  available: boolean;
}

export interface RoomSettings {
  roundCount: 5 | 10 | 15 | 20;
  guessDurationSeconds: 10 | 15 | 20 | 30;
  activityTypes: ActivityType[];
}

export interface Room {
  id: string;
  code: string;
  hostUserId: string;
  status: RoomStatus;
  settings: RoomSettings;
  currentRoundNumber: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  revealEndsAt?: string;
  gameNumber: number;
}

export interface RoomPlayer {
  id: string;
  roomId: string;
  userId: string;
  score: number;
  ready: boolean;
  connected: boolean;
  joinedAt: string;
  leftAt?: string;
}

export interface Round {
  id: string;
  roomId: string;
  gameNumber: number;
  roundNumber: number;
  sourceUserId: string;
  activityId: string;
  status: RoundStatus;
  startedAt?: string;
  answerDeadline?: string;
  revealedAt?: string;
}

export interface Guess {
  id: string;
  roundId: string;
  guessingUserId: string;
  guessedUserId: string;
  submittedAt: string;
  correct: boolean;
  points: number;
}

export interface PublicPlayer {
  userId: string;
  displayName: string;
  score: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  eligibleActivityCount: number;
}

export interface PublicRound {
  id: string;
  roundNumber: number;
  status: RoundStatus;
  activity?: Pick<SocialActivity, "videoId" | "videoUrl" | "title" | "creator" | "thumbnailUrl" | "activityType">;
  answerDeadline?: string;
  correctUserIds?: string[];
  correctDisplayNames?: string[];
  guesses?: Array<{
    guessingUserId: string;
    guessedUserId: string;
    correct: boolean;
    points: number;
  }>;
}

export interface PublicRoomState {
  serverTime: string;
  room: Room;
  viewerUserId: string;
  players: PublicPlayer[];
  round?: PublicRound;
  viewerGuess?: string;
  canStart: boolean;
  startBlockReason?: string;
}

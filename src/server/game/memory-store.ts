import type { AppUser, Guess, Room, RoomPlayer, Round, SocialActivity } from "@/features/game/types";

export interface MemoryDatabase {
  users: Map<string, AppUser>;
  rooms: Map<string, Room>;
  roomPlayers: Map<string, RoomPlayer>;
  rounds: Map<string, Round>;
  guesses: Map<string, Guess>;
  activities: Map<string, SocialActivity>;
  roundEndVotes: Map<string, Set<string>>;
  roundPlaybackStarts: Map<string, Set<string>>;
}

function createDatabase(): MemoryDatabase {
  return {
    users: new Map(),
    rooms: new Map(),
    roomPlayers: new Map(),
    rounds: new Map(),
    guesses: new Map(),
    activities: new Map(),
    roundEndVotes: new Map(),
    roundPlaybackStarts: new Map(),
  };
}

declare global {
  var __tiktokGuessDb: MemoryDatabase | undefined;
}

export function getMemoryDatabase(): MemoryDatabase {
  if (!globalThis.__tiktokGuessDb) globalThis.__tiktokGuessDb = createDatabase();
  return globalThis.__tiktokGuessDb;
}

export function resetMemoryDatabase() {
  globalThis.__tiktokGuessDb = createDatabase();
}

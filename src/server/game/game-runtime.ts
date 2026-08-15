import { hasSupabaseServerConfig } from "@/lib/supabase/config";
import { GameEngine } from "./game-engine";
import { GameError } from "./errors";
import type { GameService } from "./game-service";
import { SupabaseGameEngine } from "./supabase-game-engine";

let runtimeEngine: GameService | undefined;
let runtimeStorage: string | undefined;

export function getGameEngine(): GameService {
  const configured = process.env.GAME_STORAGE?.toLowerCase();
  const hasSupabase = hasSupabaseServerConfig();
  const storage = configured || (hasSupabase ? "supabase" : "memory");

  if (storage !== "memory" && storage !== "supabase") {
    throw new GameError("INVALID_STORAGE", `Unsupported GAME_STORAGE value: ${storage}`, 503);
  }
  if (process.env.NODE_ENV === "production" && storage === "memory") {
    throw new GameError(
      "UNSAFE_PRODUCTION_STORAGE",
      "GAME_STORAGE=memory is not supported in production. Configure Supabase and set GAME_STORAGE=supabase.",
      503,
    );
  }
  if (storage === "supabase" && !hasSupabase) {
    throw new GameError("SUPABASE_NOT_CONFIGURED", "Supabase server credentials are incomplete.", 503);
  }

  if (!runtimeEngine || runtimeStorage !== storage) {
    runtimeEngine = storage === "supabase" ? new SupabaseGameEngine() : new GameEngine();
    runtimeStorage = storage;
  }
  return runtimeEngine;
}

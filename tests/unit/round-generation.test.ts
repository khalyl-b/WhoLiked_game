import { describe, expect, it } from "vitest";
import type { SocialActivity } from "@/features/game/types";
import { buildOwnerSequence, distributeRoundOwnership, generateRoundCandidates, uniqueOwnerActivities, validateActivityCapacity } from "@/features/game/round-generation";

function seededRandom(seed = 42) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32; };
}

function activity(userId: string, videoId: string, available = true): SocialActivity {
  return { id: `${userId}-${videoId}`, userId, source: "TIKTOK", activityType: "LIKE", videoId, videoUrl: `https://example.test/${videoId}`, importedAt: "2026-01-01T00:00:00.000Z", available };
}

describe("round generation", () => {
  it("distributes rounds fairly", () => {
    const distribution = distributeRoundOwnership(["a", "b", "c", "d", "e", "f"], 10, seededRandom());
    const counts = [...distribution.values()];
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.filter((value) => value === 2)).toHaveLength(4);
  });

  it("avoids consecutive owners when a valid alternative exists", () => {
    const sequence = buildOwnerSequence(new Map([["a",2],["b",2],["c",2],["d",2]]), seededRandom());
    for (let index = 1; index < sequence.length; index += 1) expect(sequence[index]).not.toBe(sequence[index - 1]);
  });

  it("excludes videos with multiple owners and unavailable activity", () => {
    const map = new Map([
      ["a", [activity("a", "shared"), activity("a", "only-a"), activity("a", "gone", false)]],
      ["b", [activity("b", "shared"), activity("b", "only-b")]],
    ]);
    const result = uniqueOwnerActivities(map);
    expect(result.get("a")?.map((item) => item.videoId)).toEqual(["only-a"]);
    expect(result.get("b")?.map((item) => item.videoId)).toEqual(["only-b"]);
  });

  it("detects activity shortages before a game starts", () => {
    const map = new Map([
      ["a", Array.from({ length: 9 }, (_, i) => activity("a", `a-${i}`))],
      ["b", Array.from({ length: 12 }, (_, i) => activity("b", `b-${i}`))],
    ]);
    const result = validateActivityCapacity(["a", "b"], 5, map, seededRandom());
    expect(result.ok).toBe(false);
    expect(result.shortages).toEqual([{ userId: "a", eligible: 9, required: 10 }]);
  });

  it("never reuses a video within a generated game", () => {
    const players = ["a", "b", "c", "d"];
    const map = new Map(players.map((userId) => [userId, Array.from({ length: 12 }, (_, i) => activity(userId, `${userId}-${i}`))]));
    const rounds = generateRoundCandidates(players, 10, map, seededRandom());
    expect(new Set(rounds.map((round) => round.activity.videoId)).size).toBe(10);
  });
});

import { describe, expect, it } from "vitest";
import type { SocialActivity } from "@/features/game/types";
import {
  buildOwnerSequence,
  correctOwnerIdsForActivity,
  distributeRoundOwnership,
  eligibleActivitiesByUser,
  generateRoundCandidates,
  validateActivityCapacity,
} from "@/features/game/round-generation";

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

  it("keeps shared videos eligible and only removes unavailable activity", () => {
    const map = new Map([
      ["a", [activity("a", "shared"), activity("a", "only-a"), activity("a", "gone", false)]],
      ["b", [activity("b", "shared"), activity("b", "only-b")]],
    ]);
    const result = eligibleActivitiesByUser(map);
    expect(result.get("a")?.map((item) => item.videoId)).toEqual(["shared", "only-a"]);
    expect(result.get("b")?.map((item) => item.videoId)).toEqual(["shared", "only-b"]);
  });

  it("treats every player with the same liked video as a correct owner", () => {
    const sharedA = activity("a", "shared");
    const map = new Map([
      ["a", [sharedA]],
      ["b", [activity("b", "shared")]],
      ["c", [activity("c", "different")]],
    ]);
    expect(correctOwnerIdsForActivity(map, sharedA).sort()).toEqual(["a", "b"]);
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

  it("allows two players to share the same pool when enough distinct videos exist", () => {
    const sharedVideoIds = Array.from({ length: 10 }, (_, index) => `shared-${index}`);
    const map = new Map([
      ["a", sharedVideoIds.map((videoId) => activity("a", videoId))],
      ["b", sharedVideoIds.map((videoId) => activity("b", videoId))],
    ]);
    const validation = validateActivityCapacity(["a", "b"], 5, map, seededRandom());
    expect(validation.ok).toBe(true);
    const rounds = generateRoundCandidates(["a", "b"], 5, map, seededRandom(), validation.distribution);
    expect(rounds).toHaveLength(5);
    expect(new Set(rounds.map((round) => round.activity.videoId)).size).toBe(5);
  });

  it("never reuses a video within a generated game", () => {
    const players = ["a", "b", "c", "d"];
    const map = new Map(players.map((userId) => [userId, Array.from({ length: 12 }, (_, i) => activity(userId, `${userId}-${i}`))]));
    const validation = validateActivityCapacity(players, 10, map, seededRandom());
    const rounds = generateRoundCandidates(players, 10, map, seededRandom(), validation.distribution);
    expect(new Set(rounds.map((round) => round.activity.videoId)).size).toBe(10);
  });
});

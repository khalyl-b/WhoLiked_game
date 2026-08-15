import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "@/server/game/game-engine";
import { getMemoryDatabase, resetMemoryDatabase } from "@/server/game/memory-store";
import { FakeTikTokProvider } from "@/providers/social/fake-tiktok-provider";
import type { SocialActivityProvider } from "@/providers/social/social-activity-provider";
import type { SocialActivity } from "@/features/game/types";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const names = ["James", "Ahmed", "Sam", "Ryan"];

function seededRandom(seed = 7) { let state = seed >>> 0; return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32; }; }

describe("GameEngine multiplayer flow", () => {
  beforeEach(() => resetMemoryDatabase());

  it("creates, joins, hides answers, rejects duplicate guesses, scores and rematches", async () => {
    let nowMs = Date.parse("2026-08-15T12:00:00.000Z");
    const engine = new GameEngine(getMemoryDatabase(), new FakeTikTokProvider(), () => new Date(nowMs), seededRandom());
    const room = await engine.createRoom(ids[0], names[0], { roundCount: 10, guessDurationSeconds: 30, activityTypes: ["LIKE"] });
    for (let index = 1; index < ids.length; index += 1) await engine.joinRoom(room.code, ids[index], names[index]);

    const lobby = await engine.getPublicState(room.code, ids[0]);
    expect(lobby.players).toHaveLength(4);
    expect(lobby.canStart).toBe(true);
    await engine.startGame(room.code, ids[0]);

    let state = await engine.getPublicState(room.code, ids[0]);
    expect(state.round?.status).toBe("ACTIVE");
    expect(state.round?.correctUserIds).toBeUndefined();
    expect(state.round?.correctDisplayNames).toBeUndefined();

    const firstPrivateRound = [...getMemoryDatabase().rounds.values()].find((round) => round.roomId === room.id && round.roundNumber === 1)!;
    await engine.submitGuess(room.code, ids[0], firstPrivateRound.sourceUserId);
    await expect(engine.submitGuess(room.code, ids[0], firstPrivateRound.sourceUserId)).rejects.toMatchObject({ code: "DUPLICATE_GUESS" });
    for (const id of ids.slice(1)) await engine.submitGuess(room.code, id, firstPrivateRound.sourceUserId);

    state = await engine.getPublicState(room.code, ids[0]);
    expect(state.round?.status).toBe("REVEAL");
    expect(state.round?.correctUserIds).toContain(firstPrivateRound.sourceUserId);
    expect(state.players.every((player) => player.score === 1000)).toBe(true);

    for (let roundNumber = 2; roundNumber <= 10; roundNumber += 1) {
      nowMs += 4_100;
      state = await engine.getPublicState(room.code, ids[0]);
      expect(state.round?.roundNumber).toBe(roundNumber);
      expect(state.round?.correctUserIds).toBeUndefined();
      const privateRound = [...getMemoryDatabase().rounds.values()].find((round) => round.roomId === room.id && round.roundNumber === roundNumber)!;
      for (const id of ids) await engine.submitGuess(room.code, id, privateRound.sourceUserId);
      state = await engine.getPublicState(room.code, ids[0]);
      expect(state.round?.status).toBe("REVEAL");
    }

    nowMs += 4_100;
    state = await engine.getPublicState(room.code, ids[0]);
    expect(state.room.status).toBe("FINISHED");
    expect(state.players.every((player) => player.score === 10000)).toBe(true);

    await engine.createRematch(room.code, ids[0]);
    state = await engine.getPublicState(room.code, ids[0]);
    expect(state.room.status).toBe("LOBBY");
    expect(state.room.gameNumber).toBe(2);
    expect(state.players.every((player) => player.score === 0)).toBe(true);
  });

  it("transfers host when the host intentionally leaves the lobby", async () => {
    const engine = new GameEngine(getMemoryDatabase(), new FakeTikTokProvider(), () => new Date("2026-08-15T12:00:00.000Z"), seededRandom());
    const room = await engine.createRoom(ids[0], names[0], { roundCount: 10, guessDurationSeconds: 30, activityTypes: ["LIKE"] });
    await engine.joinRoom(room.code, ids[1], names[1]);
    await engine.leaveRoom(room.code, ids[0]);
    const state = await engine.getPublicState(room.code, ids[1]);
    expect(state.room.hostUserId).toBe(ids[1]);
  });

  it("enforces capacity and guess deadlines", async () => {
    let nowMs = Date.parse("2026-08-15T12:00:00.000Z");
    const engine = new GameEngine(getMemoryDatabase(), new FakeTikTokProvider(), () => new Date(nowMs), seededRandom(11));
    const room = await engine.createRoom(ids[0], names[0], { roundCount: 10, guessDurationSeconds: 30, activityTypes: ["LIKE"] });
    const extraIds = Array.from({ length: 10 }, (_, index) => `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`);
    for (let index = 0; index < 9; index += 1) await engine.joinRoom(room.code, extraIds[index], `Guest ${index}`);
    await expect(engine.joinRoom(room.code, extraIds[9], "Too many")).rejects.toMatchObject({ code: "ROOM_FULL" });

    resetMemoryDatabase();
    const deadlineEngine = new GameEngine(getMemoryDatabase(), new FakeTikTokProvider(), () => new Date(nowMs), seededRandom(12));
    const deadlineRoom = await deadlineEngine.createRoom(ids[0], names[0], { roundCount: 10, guessDurationSeconds: 30, activityTypes: ["LIKE"] });
    await deadlineEngine.joinRoom(deadlineRoom.code, ids[1], names[1]);
    await deadlineEngine.startGame(deadlineRoom.code, ids[0]);
    const privateRound = [...getMemoryDatabase().rounds.values()].find((round) => round.roomId === deadlineRoom.id && round.roundNumber === 1)!;
    await deadlineEngine.submitGuess(deadlineRoom.code, ids[0], privateRound.sourceUserId);
    await expect(deadlineEngine.submitGuess(deadlineRoom.code, ids[0], privateRound.sourceUserId)).rejects.toMatchObject({ code: "DUPLICATE_GUESS" });
    nowMs += 30_001;
    await expect(deadlineEngine.submitGuess(deadlineRoom.code, ids[1], privateRound.sourceUserId)).rejects.toMatchObject({ code: "DEADLINE_PASSED" });
    const reveal = await deadlineEngine.getPublicState(deadlineRoom.code, ids[0]);
    expect(reveal.round?.status).toBe("REVEAL");
  });

  it("awards a point for either player when both liked the same video", async () => {
    const provider: SocialActivityProvider = {
      async getLikes(userId: string): Promise<SocialActivity[]> {
        return Array.from({ length: 10 }, (_, index) => ({
          id: `${userId}-shared-${index}`,
          userId,
          source: "TIKTOK" as const,
          activityType: "LIKE" as const,
          videoId: `shared-${index}`,
          videoUrl: `https://www.tiktok.com/@fixture/video/${7000000000000000000n + BigInt(index)}`,
          importedAt: "2026-08-15T12:00:00.000Z",
          available: true,
        }));
      },
      async getReposts(): Promise<SocialActivity[]> { return []; },
    };

    const engine = new GameEngine(getMemoryDatabase(), provider, () => new Date("2026-08-15T12:00:00.000Z"), seededRandom(19));
    const room = await engine.createRoom(ids[0], names[0], { roundCount: 10, guessDurationSeconds: 30, activityTypes: ["LIKE"] });
    await engine.joinRoom(room.code, ids[1], names[1]);
    await engine.startGame(room.code, ids[0]);

    // Both users liked every candidate video. Each player deliberately chooses a
    // different answer and both must receive the point.
    await engine.submitGuess(room.code, ids[0], ids[0]);
    await engine.submitGuess(room.code, ids[1], ids[1]);

    const state = await engine.getPublicState(room.code, ids[0]);
    expect(state.round?.status).toBe("REVEAL");
    expect(state.round?.correctUserIds?.sort()).toEqual([ids[0], ids[1]].sort());
    expect(state.players.find((player) => player.userId === ids[0])?.score).toBe(1000);
    expect(state.players.find((player) => player.userId === ids[1])?.score).toBe(1000);
  });

  it("supports unlimited rounds and majority end-round voting", async () => {
    const engine = new GameEngine(getMemoryDatabase(), new FakeTikTokProvider(), () => new Date("2026-08-15T12:00:00.000Z"), seededRandom(31));
    const room = await engine.createRoom(ids[0], names[0], { roundCount: 10, guessDurationSeconds: 0, activityTypes: ["LIKE"] });
    await engine.joinRoom(room.code, ids[1], names[1]);
    await engine.joinRoom(room.code, ids[2], names[2]);
    await engine.startGame(room.code, ids[0]);

    let state = await engine.getPublicState(room.code, ids[0]);
    expect(state.round?.answerDeadline).toBeUndefined();
    expect(state.endRoundVotesRequired).toBe(2);
    expect(state.endRoundVoteCount).toBe(0);

    await engine.voteToEndRound(room.code, ids[0]);
    state = await engine.getPublicState(room.code, ids[0]);
    expect(state.round?.status).toBe("ACTIVE");
    expect(state.endRoundVoteCount).toBe(1);
    expect(state.viewerVotedToEnd).toBe(true);

    await engine.voteToEndRound(room.code, ids[1]);
    state = await engine.getPublicState(room.code, ids[0]);
    expect(state.round?.status).toBe("REVEAL");
  });

});

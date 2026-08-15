import crypto, { randomInt } from "node:crypto";
import type {
  ActivityType,
  AppUser,
  Guess,
  PublicRoomState,
  Room,
  RoomPlayer,
  RoomSettings,
  Round,
  SocialActivity,
} from "@/features/game/types";
import { FakeTikTokProvider } from "@/providers/social/fake-tiktok-provider";
import type { SocialActivityProvider } from "@/providers/social/social-activity-provider";
import { correctOwnerIdsForActivity, eligibleActivitiesByUser, generateRoundCandidates, validateActivityCapacity } from "@/features/game/round-generation";
import { GameError } from "./errors";
import { getMemoryDatabase, type MemoryDatabase } from "./memory-store";
import type { GameService } from "./game-service";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REVEAL_MS = 4_000;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;

export class GameEngine implements GameService {
  constructor(
    private readonly db: MemoryDatabase = getMemoryDatabase(),
    private readonly provider: SocialActivityProvider = new FakeTikTokProvider(),
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000,
  ) {}

  async createRoom(userId: string, displayName: string, settings: RoomSettings): Promise<Room> {
    this.validateSettings(settings);
    const user = this.upsertUser(userId, displayName);
    const code = this.generateRoomCode();
    const room: Room = {
      id: crypto.randomUUID(),
      code,
      hostUserId: user.id,
      status: "LOBBY",
      settings,
      currentRoundNumber: 0,
      createdAt: this.now().toISOString(),
      gameNumber: 1,
    };
    this.db.rooms.set(room.id, room);
    const player = this.createRoomPlayer(room.id, user.id);
    this.db.roomPlayers.set(player.id, player);
    await this.ensureFakeActivity(user.id);
    return room;
  }

  async joinRoom(code: string, userId: string, displayName: string): Promise<Room> {
    const room = this.requireRoomByCode(code);
    if (room.status !== "LOBBY") throw new GameError("ROOM_CLOSED", "This game has already started.", 409);
    const existing = this.findRoomPlayer(room.id, userId);
    if (existing && !existing.leftAt) return room;
    const activePlayers = this.activeRoomPlayers(room.id);
    if (activePlayers.length >= MAX_PLAYERS) throw new GameError("ROOM_FULL", "This room already has 10 players.", 409);
    this.upsertUser(userId, displayName);
    const player = existing ?? this.createRoomPlayer(room.id, userId);
    player.leftAt = undefined;
    player.connected = true;
    if (!existing) this.db.roomPlayers.set(player.id, player);
    await this.ensureFakeActivity(userId);
    return room;
  }

  async getPublicState(code: string, viewerUserId: string): Promise<PublicRoomState> {
    const room = this.requireRoomByCode(code);
    const viewer = this.findRoomPlayer(room.id, viewerUserId);
    if (!viewer || viewer.leftAt) throw new GameError("NOT_IN_ROOM", "You are not a member of this room.", 403);
    await this.tickRoom(room);

    const players = this.activeRoomPlayers(room.id);
    const activityByUser = this.activityByPlayer(players.map((player) => player.userId), room.settings.activityTypes);
    const eligible = eligibleActivitiesByUser(activityByUser);
    const validation = validateActivityCapacity(players.map((player) => player.userId), room.settings.roundCount, activityByUser);

    const publicPlayers = players
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((player) => ({
        userId: player.userId,
        displayName: this.requireUser(player.userId).displayName,
        score: player.score,
        ready: player.ready,
        connected: player.connected,
        isHost: room.hostUserId === player.userId,
        eligibleActivityCount: eligible.get(player.userId)?.length ?? 0,
      }));

    const round = this.currentRound(room);
    let publicRound: PublicRoomState["round"];
    let viewerGuess: string | undefined;
    if (round) {
      const activity = this.db.activities.get(round.activityId);
      const guesses = this.guessesForRound(round.id);
      viewerGuess = guesses.find((guess) => guess.guessingUserId === viewerUserId)?.guessedUserId;
      const reveal = round.status === "REVEAL" || round.status === "FINISHED" || room.status === "FINISHED";
      publicRound = {
        id: round.id,
        roundNumber: round.roundNumber,
        status: round.status,
        activity: activity ? {
          videoId: activity.videoId,
          videoUrl: activity.videoUrl,
          title: activity.title,
          creator: activity.creator,
          thumbnailUrl: activity.thumbnailUrl,
          activityType: activity.activityType,
        } : undefined,
        answerDeadline: round.answerDeadline,
        ...(reveal && activity ? (() => {
          const correctUserIds = correctOwnerIdsForActivity(activityByUser, activity);
          return {
          correctUserIds,
          correctDisplayNames: correctUserIds.map((userId) => this.requireUser(userId).displayName),
          guesses: guesses.map((guess) => ({
            guessingUserId: guess.guessingUserId,
            guessedUserId: guess.guessedUserId,
            correct: guess.correct,
            points: guess.points,
          })),
          };
        })() : {}),
      };
    }

    let startBlockReason: string | undefined;
    if (players.length < MIN_PLAYERS) startBlockReason = "At least 2 players are required.";
    else if (!validation.ok) {
      const first = validation.shortages[0];
      if (first) {
        const name = this.requireUser(first.userId).displayName;
        startBlockReason = `${name} has ${first.eligible}/${first.required} eligible videos.`;
      } else {
        startBlockReason = `The room needs at least ${room.settings.roundCount} distinct videos across the selected activity pools.`;
      }
    }

    const votes = round ? this.db.roundEndVotes.get(round.id) ?? new Set<string>() : new Set<string>();
    const activeVoters = new Set(players.map((player) => player.userId));
    const endRoundVoteCount = [...votes].filter((userId) => activeVoters.has(userId)).length;

    return {
      serverTime: this.now().toISOString(),
      room: structuredClone(room),
      viewerUserId,
      players: publicPlayers,
      round: publicRound,
      viewerGuess,
      canStart: room.status === "LOBBY" && !startBlockReason,
      startBlockReason,
      ...(round?.status === "ACTIVE" ? {
        endRoundVoteCount,
        endRoundVotesRequired: Math.floor(players.length / 2) + 1,
        viewerVotedToEnd: votes.has(viewerUserId),
      } : {}),
    };
  }

  async startGame(code: string, actorUserId: string) {
    const room = this.requireRoomByCode(code);
    this.requireHost(room, actorUserId);
    if (room.status !== "LOBBY") throw new GameError("INVALID_STATE", "Game can only start from the lobby.", 409);
    const players = this.activeRoomPlayers(room.id);
    if (players.length < MIN_PLAYERS) throw new GameError("NOT_ENOUGH_PLAYERS", "At least 2 players are required.", 409);
    const activityByUser = this.activityByPlayer(players.map((player) => player.userId), room.settings.activityTypes);
    const validation = validateActivityCapacity(players.map((player) => player.userId), room.settings.roundCount, activityByUser, this.random);
    if (!validation.ok) throw new GameError("INSUFFICIENT_ACTIVITY", "There is not enough eligible activity to create the configured number of distinct rounds.", 409);

    const candidates = generateRoundCandidates(players.map((player) => player.userId), room.settings.roundCount, activityByUser, this.random, validation.distribution);
    for (const oldRound of this.roundsForGame(room.id, room.gameNumber)) this.db.rounds.delete(oldRound.id);
    for (const candidate of candidates.entries()) {
      const [index, value] = candidate;
      const round: Round = {
        id: crypto.randomUUID(),
        roomId: room.id,
        gameNumber: room.gameNumber,
        roundNumber: index + 1,
        sourceUserId: value.ownerUserId,
        activityId: value.activity.id,
        status: "PENDING",
      };
      this.db.rounds.set(round.id, round);
    }
    for (const player of players) player.score = 0;
    room.status = "ACTIVE";
    room.startedAt = this.now().toISOString();
    room.finishedAt = undefined;
    room.currentRoundNumber = 1;
    this.startRound(room, this.requireRound(room.id, room.gameNumber, 1));
  }

  async submitGuess(code: string, actorUserId: string, guessedUserId: string) {
    const room = this.requireRoomByCode(code);
    if (room.status !== "ACTIVE") throw new GameError("INVALID_STATE", "The game is not accepting guesses.", 409);
    this.requireActivePlayer(room.id, actorUserId);
    this.requireActivePlayer(room.id, guessedUserId);
    const round = this.currentRound(room);
    if (!round || round.status !== "ACTIVE") throw new GameError("ROUND_CLOSED", "This round is not accepting guesses.", 409);
    if (round.answerDeadline && this.now().getTime() > new Date(round.answerDeadline).getTime()) {
      await this.tickRoom(room);
      throw new GameError("DEADLINE_PASSED", "The guess deadline has passed.", 409);
    }
    if (this.guessesForRound(round.id).some((guess) => guess.guessingUserId === actorUserId)) {
      throw new GameError("DUPLICATE_GUESS", "Your guess is already locked in.", 409);
    }
    const activity = this.db.activities.get(round.activityId);
    if (!activity) throw new GameError("ROUND_ACTIVITY_MISSING", "The round activity is unavailable.", 409);
    const activityByUser = this.activityByPlayer(this.activeRoomPlayers(room.id).map((player) => player.userId), room.settings.activityTypes);
    const correct = correctOwnerIdsForActivity(activityByUser, activity).includes(guessedUserId);
    const guess: Guess = {
      id: crypto.randomUUID(),
      roundId: round.id,
      guessingUserId: actorUserId,
      guessedUserId,
      submittedAt: this.now().toISOString(),
      correct,
      points: correct ? 1 : 0,
    };
    this.db.guesses.set(guess.id, guess);
    if (this.guessesForRound(round.id).length >= this.activeRoomPlayers(room.id).length) this.revealRound(room, round);
    return guess;
  }

  async voteToEndRound(code: string, actorUserId: string) {
    const room = this.requireRoomByCode(code);
    if (room.status !== "ACTIVE") throw new GameError("INVALID_STATE", "There is no active round to vote on.", 409);
    this.requireActivePlayer(room.id, actorUserId);
    const round = this.currentRound(room);
    if (!round || round.status !== "ACTIVE") throw new GameError("ROUND_CLOSED", "This round is no longer accepting votes.", 409);

    const votes = this.db.roundEndVotes.get(round.id) ?? new Set<string>();
    votes.add(actorUserId);
    this.db.roundEndVotes.set(round.id, votes);
    const players = this.activeRoomPlayers(room.id);
    const activeIds = new Set(players.map((player) => player.userId));
    const voteCount = [...votes].filter((userId) => activeIds.has(userId)).length;
    const required = Math.floor(players.length / 2) + 1;
    if (voteCount >= required) this.revealRound(room, round);
    return { voteCount, required, revealed: voteCount >= required };
  }

  async reportUnavailableRound(code: string, actorUserId: string, roundId: string, videoId: string) {
    const room = this.requireRoomByCode(code);
    this.requireActivePlayer(room.id, actorUserId);
    if (room.status !== "ACTIVE") return { replaced: false };
    const round = this.currentRound(room);
    if (!round || round.id !== roundId || round.status !== "ACTIVE") return { replaced: false };
    const current = this.db.activities.get(round.activityId);
    if (!current || current.videoId !== videoId) return { replaced: false };

    // INVALID_VIDEO from TikTok's real Embed Player means this media ID cannot
    // be served. Mark every copy of that post unavailable so it cannot be chosen
    // again for another player.
    for (const activity of this.db.activities.values()) {
      if (activity.source === current.source && activity.videoId === current.videoId) activity.available = false;
    }

    const usedVideoIds = new Set(
      this.roundsForGame(room.id, room.gameNumber)
        .filter((item) => item.id !== round.id)
        .map((item) => this.db.activities.get(item.activityId)?.videoId)
        .filter((value): value is string => !!value),
    );
    const activeIds = new Set(this.activeRoomPlayers(room.id).map((player) => player.userId));
    let pool = [...this.db.activities.values()].filter((activity) =>
      activity.available
      && activeIds.has(activity.userId)
      && room.settings.activityTypes.includes(activity.activityType)
      && !usedVideoIds.has(activity.videoId)
      && activity.activityType === current.activityType
    );
    if (!pool.length) {
      pool = [...this.db.activities.values()].filter((activity) =>
        activity.available
        && activeIds.has(activity.userId)
        && room.settings.activityTypes.includes(activity.activityType)
        && !usedVideoIds.has(activity.videoId)
      );
    }
    if (!pool.length) throw new GameError("INSUFFICIENT_ACTIVITY", "No replacement TikTok is available for this round.", 409);

    const preferred = pool.filter((activity) => activity.userId === round.sourceUserId);
    const choices = preferred.length ? preferred : pool;
    const replacement = choices[Math.floor(this.random() * choices.length)];
    round.activityId = replacement.id;
    round.sourceUserId = replacement.userId;
    round.startedAt = this.now().toISOString();
    round.answerDeadline = room.settings.guessDurationSeconds === 0
      ? undefined
      : new Date(this.now().getTime() + room.settings.guessDurationSeconds * 1000).toISOString();
    for (const [guessId, guess] of this.db.guesses) if (guess.roundId === round.id) this.db.guesses.delete(guessId);
    this.db.roundEndVotes.delete(round.id);
    return { replaced: true };
  }

  async skipRound(code: string, actorUserId: string) {
    const room = this.requireRoomByCode(code);
    this.requireHost(room, actorUserId);
    const round = this.currentRound(room);
    if (!round || room.status !== "ACTIVE") throw new GameError("INVALID_STATE", "There is no active round to skip.", 409);
    round.status = "SKIPPED";
    room.revealEndsAt = this.now().toISOString();
    this.advanceAfterReveal(room, round);
  }

  async endGame(code: string, actorUserId: string) {
    const room = this.requireRoomByCode(code);
    this.requireHost(room, actorUserId);
    room.status = "FINISHED";
    room.finishedAt = this.now().toISOString();
  }

  async createRematch(code: string, actorUserId: string) {
    const room = this.requireRoomByCode(code);
    this.requireHost(room, actorUserId);
    if (room.status !== "FINISHED") throw new GameError("INVALID_STATE", "Rematch is available after the game finishes.", 409);
    room.gameNumber += 1;
    room.status = "LOBBY";
    room.currentRoundNumber = 0;
    room.startedAt = undefined;
    room.finishedAt = undefined;
    room.revealEndsAt = undefined;
    for (const player of this.activeRoomPlayers(room.id)) player.score = 0;
    return room;
  }

  async leaveRoom(code: string, actorUserId: string) {
    const room = this.requireRoomByCode(code);
    const player = this.requireActivePlayer(room.id, actorUserId);
    player.connected = false;
    if (room.status !== "ACTIVE") player.leftAt = this.now().toISOString();
    const remaining = this.activeRoomPlayers(room.id).filter((item) => item.userId !== actorUserId || !item.leftAt).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    if (room.hostUserId === actorUserId) {
      const replacement = remaining.find((item) => item.userId !== actorUserId && !item.leftAt);
      if (replacement) room.hostUserId = replacement.userId;
    }
    if (room.status !== "ACTIVE" && this.activeRoomPlayers(room.id).length === 0) room.status = "CANCELLED";
  }

  async kickPlayer(code: string, actorUserId: string, targetUserId: string) {
    const room = this.requireRoomByCode(code);
    this.requireHost(room, actorUserId);
    if (room.status !== "LOBBY") throw new GameError("INVALID_STATE", "Players can only be kicked from the lobby.", 409);
    if (targetUserId === actorUserId) throw new GameError("INVALID_TARGET", "Use Leave room to leave as host.");
    const target = this.requireActivePlayer(room.id, targetUserId);
    target.connected = false;
    target.leftAt = this.now().toISOString();
  }

  async deleteUserSocialActivity(userId: string) {
    for (const [id, activity] of this.db.activities) if (activity.userId === userId) this.db.activities.delete(id);
  }

  private async tickRoom(room: Room) {
    if (room.status !== "ACTIVE") return;
    const round = this.currentRound(room);
    if (!round) return;
    const now = this.now().getTime();
    if (round.status === "ACTIVE" && round.answerDeadline && now >= new Date(round.answerDeadline).getTime()) {
      this.revealRound(room, round);
      return;
    }
    if (round.status === "REVEAL" && room.revealEndsAt && now >= new Date(room.revealEndsAt).getTime()) {
      this.advanceAfterReveal(room, round);
    }
  }

  private revealRound(room: Room, round: Round) {
    if (round.status !== "ACTIVE") return;
    round.status = "REVEAL";
    round.revealedAt = this.now().toISOString();
    for (const guess of this.guessesForRound(round.id)) {
      if (guess.correct) this.requireActivePlayer(room.id, guess.guessingUserId).score += guess.points;
    }
    room.revealEndsAt = new Date(this.now().getTime() + REVEAL_MS).toISOString();
  }

  private advanceAfterReveal(room: Room, round: Round) {
    if (round.status === "REVEAL") round.status = "FINISHED";
    if (room.currentRoundNumber >= room.settings.roundCount) {
      room.status = "FINISHED";
      room.finishedAt = this.now().toISOString();
      room.revealEndsAt = undefined;
      return;
    }
    room.currentRoundNumber += 1;
    room.revealEndsAt = undefined;
    this.startRound(room, this.requireRound(room.id, room.gameNumber, room.currentRoundNumber));
  }

  private startRound(room: Room, round: Round) {
    round.status = "ACTIVE";
    round.startedAt = this.now().toISOString();
    round.answerDeadline = room.settings.guessDurationSeconds === 0
      ? undefined
      : new Date(this.now().getTime() + room.settings.guessDurationSeconds * 1000).toISOString();
  }

  private validateSettings(settings: RoomSettings) {
    if (![5, 10, 15, 20].includes(settings.roundCount)) throw new GameError("INVALID_SETTINGS", "Invalid round count.");
    if (![0, 30, 45, 60, 90].includes(settings.guessDurationSeconds)) throw new GameError("INVALID_SETTINGS", "Guess timer must be 30, 45, 60, 90 seconds or Unlimited.");
    if (!settings.activityTypes.length) throw new GameError("INVALID_SETTINGS", "Select at least one activity source.");
    if (settings.activityTypes.some((type) => !(["LIKE", "REPOST"] satisfies ActivityType[]).includes(type))) throw new GameError("INVALID_SETTINGS", "Invalid activity source.");
  }

  private upsertUser(id: string, displayName: string): AppUser {
    const clean = displayName.trim().slice(0, 30);
    if (!clean) throw new GameError("INVALID_NAME", "Enter a display name.");
    const existing = this.db.users.get(id);
    const timestamp = this.now().toISOString();
    const user: AppUser = existing ? { ...existing, displayName: clean, updatedAt: timestamp } : {
      id, displayName: clean, createdAt: timestamp, updatedAt: timestamp,
    };
    this.db.users.set(id, user);
    return user;
  }

  private async ensureFakeActivity(userId: string) {
    if ([...this.db.activities.values()].some((activity) => activity.userId === userId)) return;
    const [likes, reposts] = await Promise.all([this.provider.getLikes(userId), this.provider.getReposts(userId)]);
    for (const activity of [...likes, ...reposts]) this.db.activities.set(activity.id, activity);
  }

  private activityByPlayer(playerIds: string[], activityTypes: ActivityType[]) {
    return new Map(playerIds.map((userId) => [userId, [...this.db.activities.values()].filter((activity) => activity.userId === userId && activityTypes.includes(activity.activityType))]));
  }

  private generateRoomCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) code += ROOM_ALPHABET[Math.floor(this.random() * ROOM_ALPHABET.length)];
      if (![...this.db.rooms.values()].some((room) => room.code === code && !["FINISHED", "CANCELLED"].includes(room.status))) return code;
    }
    throw new GameError("CODE_EXHAUSTED", "Could not allocate a room code.", 503);
  }

  private createRoomPlayer(roomId: string, userId: string): RoomPlayer {
    return { id: crypto.randomUUID(), roomId, userId, score: 0, ready: true, connected: true, joinedAt: this.now().toISOString() };
  }

  private requireRoomByCode(code: string) {
    const normalised = code.trim().toUpperCase();
    const room = [...this.db.rooms.values()].find((item) => item.code === normalised);
    if (!room) throw new GameError("ROOM_NOT_FOUND", "Room not found.", 404);
    return room;
  }

  private requireUser(userId: string) {
    const user = this.db.users.get(userId);
    if (!user) throw new GameError("USER_NOT_FOUND", "User not found.", 404);
    return user;
  }

  private findRoomPlayer(roomId: string, userId: string) {
    return [...this.db.roomPlayers.values()].find((player) => player.roomId === roomId && player.userId === userId);
  }

  private activeRoomPlayers(roomId: string) {
    return [...this.db.roomPlayers.values()].filter((player) => player.roomId === roomId && !player.leftAt);
  }

  private requireActivePlayer(roomId: string, userId: string) {
    const player = this.findRoomPlayer(roomId, userId);
    if (!player || player.leftAt) throw new GameError("NOT_IN_ROOM", "Player is not in this room.", 403);
    return player;
  }

  private requireHost(room: Room, actorUserId: string) {
    if (room.hostUserId !== actorUserId) throw new GameError("HOST_ONLY", "Only the host can do that.", 403);
  }

  private roundsForGame(roomId: string, gameNumber: number) {
    return [...this.db.rounds.values()].filter((round) => round.roomId === roomId && round.gameNumber === gameNumber).sort((a, b) => a.roundNumber - b.roundNumber);
  }

  private requireRound(roomId: string, gameNumber: number, roundNumber: number) {
    const round = this.roundsForGame(roomId, gameNumber).find((item) => item.roundNumber === roundNumber);
    if (!round) throw new GameError("ROUND_NOT_FOUND", "Round not found.", 404);
    return round;
  }

  private currentRound(room: Room) {
    if (!room.currentRoundNumber) return undefined;
    return this.roundsForGame(room.id, room.gameNumber).find((round) => round.roundNumber === room.currentRoundNumber);
  }

  private guessesForRound(roundId: string) {
    return [...this.db.guesses.values()].filter((guess) => guess.roundId === roundId);
  }
}

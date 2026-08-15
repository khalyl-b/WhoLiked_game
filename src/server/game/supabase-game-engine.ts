import { randomInt } from "node:crypto";
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
import { generateRoundCandidates, validateActivityCapacity } from "@/features/game/round-generation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FakeTikTokProvider } from "@/providers/social/fake-tiktok-provider";
import type { SocialActivityProvider } from "@/providers/social/social-activity-provider";
import { GameError } from "./errors";
import type { GameService } from "./game-service";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;

interface UserRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomRow {
  id: string;
  code: string;
  host_user_id: string;
  status: Room["status"];
  round_count: RoomSettings["roundCount"];
  guess_duration_seconds: RoomSettings["guessDurationSeconds"];
  activity_types: ActivityType[];
  current_round_number: number;
  game_number: number;
  reveal_ends_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface RoomPlayerRow {
  id: string;
  room_id: string;
  user_id: string;
  score: number;
  ready: boolean;
  connected: boolean;
  joined_at: string;
  left_at: string | null;
}

interface ActivityRow {
  id: string;
  user_id: string;
  provider: "TIKTOK";
  provider_activity_id: string | null;
  video_id: string;
  video_url: string;
  activity_type: ActivityType;
  activity_date: string | null;
  imported_at: string;
  available: boolean;
  metadata: Record<string, unknown> | null;
  import_source?: string;
}

interface RoundRow {
  id: string;
  room_id: string;
  game_number: number;
  round_number: number;
  source_user_id: string;
  activity_id: string;
  status: Round["status"];
  started_at: string | null;
  answer_deadline: string | null;
  revealed_at: string | null;
}

interface GuessRow {
  id: string;
  round_id: string;
  guessing_user_id: string;
  guessed_user_id: string;
  submitted_at: string;
  correct: boolean;
  points: number;
}

export class SupabaseGameEngine implements GameService {
  constructor(
    private readonly provider: SocialActivityProvider = new FakeTikTokProvider(),
    private readonly random: () => number = () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000,
  ) {}

  async createRoom(userId: string, displayName: string, settings: RoomSettings): Promise<Room> {
    this.validateSettings(settings);
    const user = await this.upsertUser(userId, displayName);
    await this.ensureProviderActivity(user.id);
    const db = this.db();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = this.randomRoomCode();
      const { data, error } = await db
        .from("rooms")
        .insert({
          code,
          host_user_id: user.id,
          status: "LOBBY",
          round_count: settings.roundCount,
          guess_duration_seconds: settings.guessDurationSeconds,
          activity_types: settings.activityTypes,
          current_round_number: 0,
          game_number: 1,
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") continue;
        throw this.databaseError(error, "Could not create room.");
      }

      const room = this.mapRoom(data as unknown as RoomRow);
      const { error: playerError } = await db.from("room_players").insert({ room_id: room.id, user_id: user.id });
      if (playerError) {
        await db.from("rooms").delete().eq("id", room.id);
        throw this.databaseError(playerError, "Could not create host membership.");
      }
      return room;
    }

    throw new GameError("CODE_EXHAUSTED", "Could not allocate a room code.", 503);
  }

  async joinRoom(code: string, userId: string, displayName: string): Promise<Room> {
    const room = await this.requireRoomByCode(code);
    await this.upsertUser(userId, displayName);
    await this.ensureProviderActivity(userId);
    const db = this.db();
    const { error } = await db.rpc("join_room_guarded", {
      p_room_id: room.id,
      p_user_id: userId,
      p_max_players: MAX_PLAYERS,
    });
    if (error) throw this.rpcError(error);
    return this.requireRoomByCode(code);
  }

  async getPublicState(code: string, viewerUserId: string): Promise<PublicRoomState> {
    let room = await this.requireRoomByCode(code);
    const db = this.db();
    const { data: viewerData, error: viewerError } = await db
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", viewerUserId)
      .is("left_at", null)
      .maybeSingle();
    if (viewerError) throw this.databaseError(viewerError, "Could not verify room membership.");
    if (!viewerData) throw new GameError("NOT_IN_ROOM", "You are not a member of this room.", 403);

    if (room.status === "ACTIVE") {
      const { error: tickError } = await db.rpc("advance_room_clock", { p_room_id: room.id });
      if (tickError) throw this.rpcError(tickError);
      room = await this.requireRoomByCode(code);
    }

    const players = await this.activeRoomPlayers(room.id);
    const users = await this.usersByIds(players.map((player) => player.userId));

    // Lobby readiness only needs per-player counts. Fetching every player's full
    // activity in one PostgREST query is incorrect because Supabase row-returning
    // queries are capped (commonly at 1,000 rows), allowing one large account to
    // consume the whole response and make later players appear to have zero videos.
    let lobbyActivityCounts = new Map<string, number>();
    let lobbyShortages: Array<{ userId: string; eligible: number; required: number }> = [];
    if (room.status === "LOBBY") {
      lobbyActivityCounts = await this.activityCountsByPlayer(players.map((player) => player.userId), room.settings.activityTypes);
      // Under the current MVP limits (2-10 players, max 20 rounds), no player can
      // own more than 10 rounds, and the product already requires at least 10 items.
      lobbyShortages = players
        .map((player) => ({ userId: player.userId, eligible: lobbyActivityCounts.get(player.userId) ?? 0, required: 10 }))
        .filter((item) => item.eligible < item.required);
    }

    const publicPlayers = players
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((player) => ({
        userId: player.userId,
        displayName: users.get(player.userId)?.displayName ?? "Player",
        score: player.score,
        ready: player.ready,
        connected: player.connected,
        isHost: room.hostUserId === player.userId,
        eligibleActivityCount: lobbyActivityCounts.get(player.userId) ?? 0,
      }));

    const round = await this.currentRound(room);
    let publicRound: PublicRoomState["round"];
    let viewerGuess: string | undefined;

    if (round) {
      const [activity, guesses] = await Promise.all([
        this.activityById(round.activityId),
        this.guessesForRound(round.id),
      ]);
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
        ...(reveal && activity ? await (async () => {
          const correctUserIds = await this.correctOwnerIdsForActivity(room.id, round.activityId);
          return {
            correctUserIds,
            correctDisplayNames: correctUserIds.map((userId) => users.get(userId)?.displayName ?? "Player"),
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
    if (room.status === "LOBBY") {
      if (players.length < MIN_PLAYERS) startBlockReason = "At least 2 players are required.";
      else if (lobbyShortages.length > 0) {
        const first = lobbyShortages[0];
        const name = users.get(first.userId)?.displayName ?? "A player";
        startBlockReason = `${name} has ${first.eligible}/${first.required} eligible videos.`;
      }
    }

    return {
      serverTime: new Date().toISOString(),
      room,
      viewerUserId,
      players: publicPlayers,
      round: publicRound,
      viewerGuess,
      canStart: room.status === "LOBBY" && !startBlockReason,
      startBlockReason,
    };
  }

  async startGame(code: string, actorUserId: string): Promise<void> {
    const room = await this.requireRoomByCode(code);
    if (room.hostUserId !== actorUserId) throw new GameError("HOST_ONLY", "Only the host can do that.", 403);
    if (room.status !== "LOBBY") throw new GameError("INVALID_STATE", "Game can only start from the lobby.", 409);

    const players = await this.activeRoomPlayers(room.id);
    if (players.length < MIN_PLAYERS) throw new GameError("NOT_ENOUGH_PLAYERS", "At least 2 players are required.", 409);
    const playerIds = players.map((player) => player.userId);
    const activityByUser = await this.activityByPlayer(playerIds, room.settings.activityTypes);
    const validation = validateActivityCapacity(playerIds, room.settings.roundCount, activityByUser, this.random);
    if (!validation.ok) {
      const users = await this.usersByIds(playerIds);
      if (validation.shortages.length > 0) {
        const details = validation.shortages.map(({ userId, eligible, required }) => {
          const name = users.get(userId)?.displayName ?? "Player";
          return `${name}: ${eligible}/${required} eligible`;
        });
        throw new GameError(
          "INSUFFICIENT_ACTIVITY",
          `One or more players do not have enough eligible videos. ${details.join("; ")}. Shared likes are allowed.`,
          409,
        );
      }
      throw new GameError(
        "INSUFFICIENT_ACTIVITY",
        `The room does not have enough distinct videos to create ${room.settings.roundCount} non-repeating rounds. Shared likes are allowed and count for every player who liked them.`,
        409,
      );
    }

    const candidates = generateRoundCandidates(playerIds, room.settings.roundCount, activityByUser, this.random, validation.distribution);
    const payload = candidates.map((candidate) => ({
      sourceUserId: candidate.ownerUserId,
      activityId: candidate.activity.id,
    }));
    const { error } = await this.db().rpc("commit_game_start", {
      p_room_id: room.id,
      p_actor_user_id: actorUserId,
      p_game_number: room.gameNumber,
      p_player_ids: playerIds,
      p_rounds: payload,
    });
    if (error) throw this.rpcError(error);
  }

  async submitGuess(code: string, actorUserId: string, guessedUserId: string) {
    const room = await this.requireRoomByCode(code);
    const { data, error } = await this.db().rpc("submit_guess_and_maybe_reveal", {
      p_room_id: room.id,
      p_guessing_user_id: actorUserId,
      p_guessed_user_id: guessedUserId,
    });
    if (error) throw this.rpcError(error);
    return data;
  }

  async skipRound(code: string, actorUserId: string): Promise<void> {
    const room = await this.requireRoomByCode(code);
    const { error } = await this.db().rpc("skip_current_round", { p_room_id: room.id, p_actor_user_id: actorUserId });
    if (error) throw this.rpcError(error);
  }

  async endGame(code: string, actorUserId: string): Promise<void> {
    const room = await this.requireRoomByCode(code);
    const { error } = await this.db().rpc("end_game_guarded", { p_room_id: room.id, p_actor_user_id: actorUserId });
    if (error) throw this.rpcError(error);
  }

  async createRematch(code: string, actorUserId: string): Promise<Room> {
    const room = await this.requireRoomByCode(code);
    const { error } = await this.db().rpc("create_rematch_guarded", { p_room_id: room.id, p_actor_user_id: actorUserId });
    if (error) throw this.rpcError(error);
    return this.requireRoomByCode(code);
  }

  async leaveRoom(code: string, actorUserId: string): Promise<void> {
    const room = await this.requireRoomByCode(code);
    const { error } = await this.db().rpc("leave_room_guarded", { p_room_id: room.id, p_actor_user_id: actorUserId });
    if (error) throw this.rpcError(error);
  }

  async kickPlayer(code: string, actorUserId: string, targetUserId: string): Promise<void> {
    const room = await this.requireRoomByCode(code);
    const { error } = await this.db().rpc("kick_player_guarded", {
      p_room_id: room.id,
      p_actor_user_id: actorUserId,
      p_target_user_id: targetUserId,
    });
    if (error) throw this.rpcError(error);
  }

  async deleteUserSocialActivity(userId: string): Promise<void> {
    const { error } = await this.db().from("social_activity").delete().eq("user_id", userId);
    if (error) throw this.databaseError(error, "Could not delete imported social activity.");
  }

  private db() {
    const client = createSupabaseAdminClient();
    if (!client) throw new GameError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured on the server.", 503);
    return client;
  }

  private async upsertUser(id: string, displayName: string): Promise<AppUser> {
    const clean = displayName.trim().slice(0, 30);
    if (!clean) throw new GameError("INVALID_NAME", "Enter a display name.");
    const timestamp = new Date().toISOString();
    const { data, error } = await this.db()
      .from("users")
      .upsert({ id, auth_user_id: id, display_name: clean, updated_at: timestamp }, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw this.databaseError(error, "Could not save player.");
    return this.mapUser(data as unknown as UserRow);
  }

  private async ensureProviderActivity(userId: string) {
    const db = this.db();
    const providerMode = (process.env.SOCIAL_ACTIVITY_PROVIDER ?? "fake").toLowerCase();

    // Fixture records are deliberately removed when production switches to the real
    // TikTok provider so test likes can never leak into a real user's game pool.
    if (providerMode === "tiktok") {
      const { error: fixtureDeleteError } = await db
        .from("social_activity")
        .delete()
        .eq("user_id", userId)
        .eq("import_source", "fixture");
      if (fixtureDeleteError) throw this.databaseError(fixtureDeleteError, "Could not remove development activity.");
    }

    let countQuery = db
      .from("social_activity")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (providerMode === "tiktok") countQuery = countQuery.neq("import_source", "fixture");
    const { count, error: countError } = await countQuery;
    if (countError) throw this.databaseError(countError, "Could not inspect activity.");
    if ((count ?? 0) > 0) return;

    const [likes, reposts] = await Promise.all([this.provider.getLikes(userId), this.provider.getReposts(userId)]);
    const rows = [...likes, ...reposts].map((activity) => ({
      user_id: userId,
      provider: "TIKTOK" as const,
      provider_activity_id: activity.id,
      video_id: activity.videoId,
      video_url: activity.videoUrl,
      activity_type: activity.activityType,
      activity_date: activity.activityDate ?? null,
      imported_at: activity.importedAt,
      available: activity.available,
      import_source: providerMode === "fake" ? "fixture" : "provider",
      metadata: {
        title: activity.title ?? null,
        creator: activity.creator ?? null,
        thumbnailUrl: activity.thumbnailUrl ?? null,
        fixture: providerMode === "fake",
      },
    }));
    if (rows.length === 0) return;
    const { error } = await db.from("social_activity").upsert(rows, { onConflict: "user_id,provider,activity_type,video_id" });
    if (error) throw this.databaseError(error, "Could not load social activity.");
  }

  private async requireRoomByCode(code: string): Promise<Room> {
    const normalised = code.trim().toUpperCase();
    const { data, error } = await this.db().from("rooms").select("*").eq("code", normalised).maybeSingle();
    if (error) throw this.databaseError(error, "Could not load room.");
    if (!data) throw new GameError("ROOM_NOT_FOUND", "Room not found.", 404);
    return this.mapRoom(data as unknown as RoomRow);
  }

  private async requireUser(userId: string): Promise<AppUser> {
    const { data, error } = await this.db().from("users").select("*").eq("id", userId).maybeSingle();
    if (error) throw this.databaseError(error, "Could not load user.");
    if (!data) throw new GameError("USER_NOT_FOUND", "User not found.", 404);
    return this.mapUser(data as unknown as UserRow);
  }

  private async usersByIds(userIds: string[]): Promise<Map<string, AppUser>> {
    if (userIds.length === 0) return new Map<string, AppUser>();
    const { data, error } = await this.db().from("users").select("*").in("id", userIds);
    if (error) throw this.databaseError(error, "Could not load players.");
    const rows = (data ?? []) as unknown[];
    const users: AppUser[] = rows.map((row: unknown) => this.mapUser(row as UserRow));
    return new Map<string, AppUser>(users.map((user: AppUser) => [user.id, user]));
  }

  private async activeRoomPlayers(roomId: string): Promise<RoomPlayer[]> {
    const { data, error } = await this.db().from("room_players").select("*").eq("room_id", roomId).is("left_at", null);
    if (error) throw this.databaseError(error, "Could not load room players.");
    return ((data ?? []) as unknown[]).map((row: unknown) => this.mapRoomPlayer(row as RoomPlayerRow));
  }

  private async activityCountsByPlayer(playerIds: string[], activityTypes: ActivityType[]) {
    const counts = new Map(playerIds.map((id) => [id, 0]));
    const excludeFixtures = (process.env.SOCIAL_ACTIVITY_PROVIDER ?? "fake").toLowerCase() === "tiktok";

    await Promise.all(playerIds.map(async (userId) => {
      let query = this.db()
        .from("social_activity")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("available", true)
        .in("activity_type", activityTypes);
      if (excludeFixtures) query = query.neq("import_source", "fixture");
      const { count, error } = await query;
      if (error) throw this.databaseError(error, "Could not count social activity.");
      counts.set(userId, count ?? 0);
    }));

    return counts;
  }

  private async activityByPlayer(playerIds: string[], activityTypes: ActivityType[]) {
    const grouped = new Map(playerIds.map((id) => [id, [] as SocialActivity[]]));
    if (playerIds.length === 0) return grouped;

    const pageSize = 1000;
    const excludeFixtures = (process.env.SOCIAL_ACTIVITY_PROVIDER ?? "fake").toLowerCase() === "tiktok";

    // Fetch each player's activity independently and page through the complete
    // result set. This is used when starting a game, where we need the full pool
    // to generate fair non-repeating rounds even when room members share liked videos.
    await Promise.all(playerIds.map(async (userId) => {
      let from = 0;
      while (true) {
        let query = this.db()
          .from("social_activity")
          .select("*")
          .eq("user_id", userId)
          .eq("available", true)
          .in("activity_type", activityTypes)
          .order("imported_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (excludeFixtures) query = query.neq("import_source", "fixture");

        const { data, error } = await query;
        if (error) throw this.databaseError(error, "Could not load social activity.");
        const rows = (data ?? []) as unknown[];
        for (const row of rows) grouped.get(userId)?.push(this.mapActivity(row as ActivityRow));
        if (rows.length < pageSize) break;
        from += pageSize;
      }
    }));

    return grouped;
  }

  private async correctOwnerIdsForActivity(roomId: string, activityId: string): Promise<string[]> {
    const db = this.db();
    const { data: selectedData, error: selectedError } = await db
      .from("social_activity")
      .select("video_id,activity_type,import_source")
      .eq("id", activityId)
      .maybeSingle();
    if (selectedError) throw this.databaseError(selectedError, "Could not load round ownership.");
    if (!selectedData) return [];

    const players = await this.activeRoomPlayers(roomId);
    const playerIds = players.map((player) => player.userId);
    if (playerIds.length === 0) return [];

    const selected = selectedData as { video_id: string; activity_type: ActivityType; import_source?: string };
    let query = db
      .from("social_activity")
      .select("user_id")
      .in("user_id", playerIds)
      .eq("video_id", selected.video_id)
      .eq("activity_type", selected.activity_type)
      .eq("available", true);

    if (selected.import_source === "fixture") query = query.eq("import_source", "fixture");
    else query = query.neq("import_source", "fixture");

    const { data, error } = await query;
    if (error) throw this.databaseError(error, "Could not load round ownership.");
    const correctIds = new Set(((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
    return players
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((player) => player.userId)
      .filter((userId) => correctIds.has(userId));
  }

  private async activityById(activityId: string): Promise<SocialActivity | null> {
    const { data, error } = await this.db().from("social_activity").select("*").eq("id", activityId).maybeSingle();
    if (error) throw this.databaseError(error, "Could not load round activity.");
    return data ? this.mapActivity(data as unknown as ActivityRow) : null;
  }

  private async currentRound(room: Room): Promise<Round | undefined> {
    if (!room.currentRoundNumber) return undefined;
    const { data, error } = await this.db()
      .from("rounds")
      .select("*")
      .eq("room_id", room.id)
      .eq("game_number", room.gameNumber)
      .eq("round_number", room.currentRoundNumber)
      .maybeSingle();
    if (error) throw this.databaseError(error, "Could not load current round.");
    return data ? this.mapRound(data as unknown as RoundRow) : undefined;
  }

  private async guessesForRound(roundId: string): Promise<Guess[]> {
    const { data, error } = await this.db().from("guesses").select("*").eq("round_id", roundId);
    if (error) throw this.databaseError(error, "Could not load guesses.");
    return ((data ?? []) as unknown[]).map((row: unknown) => this.mapGuess(row as GuessRow));
  }

  private validateSettings(settings: RoomSettings) {
    if (![5, 10, 15, 20].includes(settings.roundCount)) throw new GameError("INVALID_SETTINGS", "Invalid round count.");
    if (![10, 15, 20, 30].includes(settings.guessDurationSeconds)) throw new GameError("INVALID_SETTINGS", "Invalid guess timer.");
    if (!settings.activityTypes.length) throw new GameError("INVALID_SETTINGS", "Select at least one activity source.");
    if (settings.activityTypes.some((type) => !("LIKE" === type || "REPOST" === type))) throw new GameError("INVALID_SETTINGS", "Invalid activity source.");
  }

  private randomRoomCode() {
    let code = "";
    for (let index = 0; index < 6; index += 1) code += ROOM_ALPHABET[Math.floor(this.random() * ROOM_ALPHABET.length)];
    return code;
  }

  private mapUser(row: UserRow): AppUser {
    return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private mapRoom(row: RoomRow): Room {
    return {
      id: row.id,
      code: row.code,
      hostUserId: row.host_user_id,
      status: row.status,
      settings: {
        roundCount: row.round_count,
        guessDurationSeconds: row.guess_duration_seconds,
        activityTypes: row.activity_types,
      },
      currentRoundNumber: row.current_round_number,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      revealEndsAt: row.reveal_ends_at ?? undefined,
      gameNumber: row.game_number,
    };
  }

  private mapRoomPlayer(row: RoomPlayerRow): RoomPlayer {
    return {
      id: row.id,
      roomId: row.room_id,
      userId: row.user_id,
      score: row.score,
      ready: row.ready,
      connected: row.connected,
      joinedAt: row.joined_at,
      leftAt: row.left_at ?? undefined,
    };
  }

  private mapActivity(row: ActivityRow): SocialActivity {
    const metadata = row.metadata ?? {};
    return {
      id: row.id,
      userId: row.user_id,
      source: "TIKTOK",
      activityType: row.activity_type,
      videoId: row.video_id,
      videoUrl: row.video_url,
      title: typeof metadata.title === "string" ? metadata.title : undefined,
      creator: typeof metadata.creator === "string" ? metadata.creator : undefined,
      thumbnailUrl: typeof metadata.thumbnailUrl === "string" ? metadata.thumbnailUrl : undefined,
      activityDate: row.activity_date ?? undefined,
      importedAt: row.imported_at,
      available: row.available,
    };
  }

  private mapRound(row: RoundRow): Round {
    return {
      id: row.id,
      roomId: row.room_id,
      gameNumber: row.game_number,
      roundNumber: row.round_number,
      sourceUserId: row.source_user_id,
      activityId: row.activity_id,
      status: row.status,
      startedAt: row.started_at ?? undefined,
      answerDeadline: row.answer_deadline ?? undefined,
      revealedAt: row.revealed_at ?? undefined,
    };
  }

  private mapGuess(row: GuessRow): Guess {
    return {
      id: row.id,
      roundId: row.round_id,
      guessingUserId: row.guessing_user_id,
      guessedUserId: row.guessed_user_id,
      submittedAt: row.submitted_at,
      correct: row.correct,
      points: row.points,
    };
  }

  private databaseError(error: { message?: string; code?: string }, fallback: string) {
    console.error("Supabase game storage error", error);
    return new GameError("DATABASE_ERROR", error.message || fallback, 500);
  }

  private rpcError(error: { message?: string; code?: string }) {
    const message = error.message ?? "Game operation failed.";
    const code = message.match(/(ROOM_NOT_FOUND|ROOM_FULL|ROOM_CLOSED|NOT_IN_ROOM|INVALID_GUESSED_PLAYER|HOST_ONLY|INVALID_STATE|ROUND_NOT_FOUND|ROUND_CLOSED|DEADLINE_PASSED|DUPLICATE_GUESS|PLAYER_SET_CHANGED|INSUFFICIENT_ACTIVITY|INVALID_TARGET)/)?.[1];
    const status = code === "ROOM_NOT_FOUND" || code === "ROUND_NOT_FOUND" ? 404
      : code === "NOT_IN_ROOM" || code === "HOST_ONLY" ? 403
      : 409;
    const friendly: Record<string, string> = {
      ROOM_NOT_FOUND: "Room not found.",
      ROOM_FULL: "This room already has 10 players.",
      ROOM_CLOSED: "This game has already started.",
      NOT_IN_ROOM: "Player is not in this room.",
      INVALID_GUESSED_PLAYER: "That player is not in this room.",
      HOST_ONLY: "Only the host can do that.",
      INVALID_STATE: "The game is not in the right state for that action.",
      ROUND_NOT_FOUND: "Round not found.",
      ROUND_CLOSED: "This round is not accepting guesses.",
      DEADLINE_PASSED: "The guess deadline has passed.",
      DUPLICATE_GUESS: "Your guess is already locked in.",
      PLAYER_SET_CHANGED: "The player list changed while the game was starting. Press Start again.",
      INSUFFICIENT_ACTIVITY: "There is not enough eligible activity to start this game.",
      INVALID_TARGET: "That player cannot be removed.",
    };
    return new GameError(code ?? "DATABASE_OPERATION_FAILED", code ? friendly[code] : message, status);
  }
}

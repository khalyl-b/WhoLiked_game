import type { SocialActivity } from "./types";

export interface RoundCandidate {
  ownerUserId: string;
  activity: SocialActivity;
}

export function distributeRoundOwnership(playerIds: string[], roundCount: number, random: () => number = Math.random): Map<string, number> {
  if (playerIds.length < 2) throw new Error("At least two players are required");
  const base = Math.floor(roundCount / playerIds.length);
  const remainder = roundCount % playerIds.length;
  const shuffled = shuffle([...playerIds], random);
  return new Map(playerIds.map((id) => [id, base + (shuffled.slice(0, remainder).includes(id) ? 1 : 0)]));
}

export function buildOwnerSequence(distribution: Map<string, number>, random: () => number = Math.random): string[] {
  const remaining = new Map(distribution);
  const sequence: string[] = [];
  while ([...remaining.values()].some((value) => value > 0)) {
    const candidates = [...remaining.entries()]
      .filter(([, count]) => count > 0)
      .filter(([id]) => id !== sequence.at(-1));
    const pool = candidates.length > 0 ? candidates : [...remaining.entries()].filter(([, count]) => count > 0);
    const max = Math.max(...pool.map(([, count]) => count));
    const weighted = pool.filter(([, count]) => count === max);
    const [chosen] = weighted[Math.floor(random() * weighted.length)];
    sequence.push(chosen);
    remaining.set(chosen, (remaining.get(chosen) ?? 0) - 1);
  }
  return sequence;
}

/**
 * Returns every available activity that can legitimately be used for a round.
 * Shared videos are intentionally retained: if multiple room members liked the
 * same video, all of those members are valid answers for that round.
 *
 * A single user only needs one candidate row per video because a video may only
 * appear once in the same game.
 */
export function eligibleActivitiesByUser(activityByUser: Map<string, SocialActivity[]>): Map<string, SocialActivity[]> {
  const output = new Map<string, SocialActivity[]>();
  for (const [userId, activities] of activityByUser) {
    const byVideo = new Map<string, SocialActivity>();
    for (const activity of activities) {
      if (!activity.available) continue;
      if (!byVideo.has(activity.videoId)) byVideo.set(activity.videoId, activity);
    }
    output.set(userId, [...byVideo.values()]);
  }
  return output;
}

/**
 * Backwards-compatible alias retained for older callers. The game no longer
 * excludes shared-owner videos, so "unique owner" is no longer the rule.
 */
export const uniqueOwnerActivities = eligibleActivitiesByUser;

export function correctOwnerIdsForActivity(
  activityByUser: Map<string, SocialActivity[]>,
  activity: Pick<SocialActivity, "videoId" | "activityType">,
): string[] {
  const owners: string[] = [];
  for (const [userId, activities] of activityByUser) {
    if (activities.some((item) => item.available && item.videoId === activity.videoId && item.activityType === activity.activityType)) {
      owners.push(userId);
    }
  }
  return owners;
}

export function generateRoundCandidates(
  playerIds: string[],
  roundCount: number,
  activityByUser: Map<string, SocialActivity[]>,
  random: () => number = Math.random,
  distributionOverride?: Map<string, number>,
): RoundCandidate[] {
  const eligible = eligibleActivitiesByUser(activityByUser);
  const distribution = distributionOverride ?? distributeRoundOwnership(playerIds, roundCount, random);
  const ownerSequence = buildOwnerSequence(distribution, random);
  const pools = new Map(
    [...eligible.entries()].map(([id, activities]) => [id, shuffle([...activities], random)]),
  );

  // Assign one distinct video to every round slot using an augmenting-path
  // matching algorithm. This is more robust than greedy selection when several
  // players share a large part of the same Like List.
  const slotVideoIds = new Array<string | undefined>(ownerSequence.length);
  const videoToSlot = new Map<string, number>();

  function tryAssign(slotIndex: number, seenVideos: Set<string>, seenSlots: Set<number>): boolean {
    if (seenSlots.has(slotIndex)) return false;
    seenSlots.add(slotIndex);
    const ownerUserId = ownerSequence[slotIndex];
    const pool = pools.get(ownerUserId) ?? [];

    for (const activity of pool) {
      const videoId = activity.videoId;
      if (seenVideos.has(videoId)) continue;
      seenVideos.add(videoId);
      const displacedSlot = videoToSlot.get(videoId);
      if (displacedSlot === undefined || tryAssign(displacedSlot, seenVideos, seenSlots)) {
        videoToSlot.set(videoId, slotIndex);
        slotVideoIds[slotIndex] = videoId;
        return true;
      }
    }
    return false;
  }

  // Constrained owners first improves matching stability without changing the
  // final round order.
  const slotsByConstraint = ownerSequence
    .map((ownerUserId, index) => ({ index, size: pools.get(ownerUserId)?.length ?? 0 }))
    .sort((a, b) => a.size - b.size || a.index - b.index);

  for (const { index } of slotsByConstraint) {
    if (!tryAssign(index, new Set<string>(), new Set<number>())) {
      throw new Error(`Not enough eligible activity for ${ownerSequence[index]}`);
    }
  }

  return ownerSequence.map((ownerUserId, index) => {
    const videoId = slotVideoIds[index];
    if (!videoId) throw new Error(`Not enough eligible activity for ${ownerUserId}`);
    const activity = (pools.get(ownerUserId) ?? []).find((item) => item.videoId === videoId);
    if (!activity) throw new Error(`Not enough eligible activity for ${ownerUserId}`);
    return { ownerUserId, activity };
  });
}

export function validateActivityCapacity(
  playerIds: string[],
  roundCount: number,
  activityByUser: Map<string, SocialActivity[]>,
  random: () => number = () => 0.5,
) {
  const eligible = eligibleActivitiesByUser(activityByUser);
  const distribution = distributeRoundOwnership(playerIds, roundCount, random);
  const shortages = playerIds
    .map((userId) => ({ userId, eligible: eligible.get(userId)?.length ?? 0, required: Math.max(10, distribution.get(userId) ?? 0) }))
    .filter((item) => item.eligible < item.required);

  const globalDistinctVideos = new Set(
    [...eligible.values()].flatMap((activities) => activities.map((activity) => activity.videoId)),
  ).size;

  const assignmentPossible = shortages.length === 0
    && globalDistinctVideos >= roundCount
    && satisfiesHallCondition(playerIds, distribution, eligible);

  return {
    eligible,
    distribution,
    shortages,
    globalDistinctVideos,
    assignmentPossible,
    ok: shortages.length === 0 && assignmentPossible,
  };
}

function satisfiesHallCondition(
  playerIds: string[],
  distribution: Map<string, number>,
  eligible: Map<string, SocialActivity[]>,
): boolean {
  const owners = playerIds.filter((userId) => (distribution.get(userId) ?? 0) > 0);
  if (owners.length > 20) return false;

  const subsetCount = 1 << owners.length;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    let requiredRounds = 0;
    const availableVideos = new Set<string>();
    for (let index = 0; index < owners.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const userId = owners[index];
      requiredRounds += distribution.get(userId) ?? 0;
      for (const activity of eligible.get(userId) ?? []) availableVideos.add(activity.videoId);
    }
    if (availableVideos.size < requiredRounds) return false;
  }
  return true;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

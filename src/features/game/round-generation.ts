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

export function uniqueOwnerActivities(activityByUser: Map<string, SocialActivity[]>): Map<string, SocialActivity[]> {
  const ownersByVideo = new Map<string, Set<string>>();
  for (const [userId, activities] of activityByUser) {
    for (const activity of activities) {
      if (!activity.available) continue;
      const owners = ownersByVideo.get(activity.videoId) ?? new Set<string>();
      owners.add(userId);
      ownersByVideo.set(activity.videoId, owners);
    }
  }

  const output = new Map<string, SocialActivity[]>();
  for (const [userId, activities] of activityByUser) {
    output.set(userId, activities.filter((activity) => activity.available && ownersByVideo.get(activity.videoId)?.size === 1));
  }
  return output;
}

export function generateRoundCandidates(
  playerIds: string[],
  roundCount: number,
  activityByUser: Map<string, SocialActivity[]>,
  random: () => number = Math.random,
): RoundCandidate[] {
  const unique = uniqueOwnerActivities(activityByUser);
  const distribution = distributeRoundOwnership(playerIds, roundCount, random);
  const ownerSequence = buildOwnerSequence(distribution, random);
  const pools = new Map([...unique.entries()].map(([id, activities]) => [id, shuffle([...activities], random)]));
  const usedVideoIds = new Set<string>();

  return ownerSequence.map((ownerUserId) => {
    const pool = pools.get(ownerUserId) ?? [];
    const activity = pool.find((item) => !usedVideoIds.has(item.videoId));
    if (!activity) throw new Error(`Not enough eligible activity for ${ownerUserId}`);
    usedVideoIds.add(activity.videoId);
    pools.set(ownerUserId, pool.filter((item) => item.id !== activity.id));
    return { ownerUserId, activity };
  });
}

export function validateActivityCapacity(
  playerIds: string[],
  roundCount: number,
  activityByUser: Map<string, SocialActivity[]>,
  random: () => number = () => 0.5,
) {
  const eligible = uniqueOwnerActivities(activityByUser);
  const distribution = distributeRoundOwnership(playerIds, roundCount, random);
  const shortages = playerIds
    .map((userId) => ({ userId, eligible: eligible.get(userId)?.length ?? 0, required: Math.max(10, distribution.get(userId) ?? 0) }))
    .filter((item) => item.eligible < item.required);
  return { eligible, distribution, shortages, ok: shortages.length === 0 };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

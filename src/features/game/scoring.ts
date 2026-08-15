export const MAX_CORRECT_GUESS_POINTS = 1000;
export const MIN_CORRECT_GUESS_POINTS = 500;

/**
 * Correct timed guesses decay linearly from 1000 points at round start to
 * 500 points immediately before the deadline. Unlimited rounds have no time
 * pressure, so a correct answer is worth the full 1000 points.
 */
export function calculateCorrectGuessPoints({
  startedAt,
  answerDeadline,
  submittedAt,
}: {
  startedAt?: string;
  answerDeadline?: string;
  submittedAt: string;
}) {
  if (!answerDeadline) return MAX_CORRECT_GUESS_POINTS;

  const startMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const deadlineMs = new Date(answerDeadline).getTime();
  const submittedMs = new Date(submittedAt).getTime();
  const durationMs = deadlineMs - startMs;

  if (!Number.isFinite(startMs) || !Number.isFinite(deadlineMs) || !Number.isFinite(submittedMs) || durationMs <= 0) {
    return MIN_CORRECT_GUESS_POINTS;
  }

  const remainingFraction = Math.max(0, Math.min(1, (deadlineMs - submittedMs) / durationMs));
  return Math.max(
    MIN_CORRECT_GUESS_POINTS,
    Math.min(
      MAX_CORRECT_GUESS_POINTS,
      Math.round(MIN_CORRECT_GUESS_POINTS + (MAX_CORRECT_GUESS_POINTS - MIN_CORRECT_GUESS_POINTS) * remainingFraction),
    ),
  );
}

export function calculateDisplayedPotentialPoints(remainingMs: number, durationSeconds: number) {
  if (durationSeconds <= 0) return MAX_CORRECT_GUESS_POINTS;
  const durationMs = durationSeconds * 1000;
  const remainingFraction = Math.max(0, Math.min(1, remainingMs / durationMs));
  return Math.max(
    MIN_CORRECT_GUESS_POINTS,
    Math.min(
      MAX_CORRECT_GUESS_POINTS,
      Math.round(MIN_CORRECT_GUESS_POINTS + (MAX_CORRECT_GUESS_POINTS - MIN_CORRECT_GUESS_POINTS) * remainingFraction),
    ),
  );
}

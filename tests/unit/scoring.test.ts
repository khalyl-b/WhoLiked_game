import { describe, expect, it } from "vitest";
import { calculateCorrectGuessPoints, calculateDisplayedPotentialPoints } from "@/features/game/scoring";

describe("time-decay scoring", () => {
  const start = "2026-08-15T12:00:00.000Z";
  const deadline = "2026-08-15T12:00:30.000Z";

  it("starts at 1000 and decays linearly to 500", () => {
    expect(calculateCorrectGuessPoints({ startedAt: start, answerDeadline: deadline, submittedAt: start })).toBe(1000);
    expect(calculateCorrectGuessPoints({ startedAt: start, answerDeadline: deadline, submittedAt: "2026-08-15T12:00:15.000Z" })).toBe(750);
    expect(calculateCorrectGuessPoints({ startedAt: start, answerDeadline: deadline, submittedAt: "2026-08-15T12:00:29.999Z" })).toBe(500);
  });

  it("keeps unlimited correct answers at 1000", () => {
    expect(calculateCorrectGuessPoints({ startedAt: start, submittedAt: "2026-08-15T12:30:00.000Z" })).toBe(1000);
  });

  it("uses the same curve for the live points display", () => {
    expect(calculateDisplayedPotentialPoints(30_000, 30)).toBe(1000);
    expect(calculateDisplayedPotentialPoints(15_000, 30)).toBe(750);
    expect(calculateDisplayedPotentialPoints(1, 30)).toBe(500);
  });
});

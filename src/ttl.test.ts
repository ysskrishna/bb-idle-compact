import { describe, expect, it } from "vitest";
import { addObservation, estimateTtl, MAX_OBSERVATIONS, type Observation, observe, summarize } from "./ttl.js";

const MIN = 60_000;
const hit = (gapMin: number): Observation => ({ gapMs: gapMin * MIN, hit: true, at: 0 });
const miss = (gapMin: number): Observation => ({ gapMs: gapMin * MIN, hit: false, at: 0 });

describe("observe", () => {
  it("ignores short gaps and tiny prompts", () => {
    expect(observe(4 * MIN, 50_000, 50_000, 0)).toBeNull();
    expect(observe(40 * MIN, 900, 900, 0)).toBeNull();
  });
  it("counts a hit when at least half the input was cached", () => {
    expect(observe(40 * MIN, 100_000, 60_000, 0)?.hit).toBe(true);
    expect(observe(40 * MIN, 100_000, 10_000, 0)?.hit).toBe(false);
  });
});

describe("estimateTtl", () => {
  it("keeps the default until three hits beyond 30 minutes", () => {
    expect(estimateTtl([])).toBeNull();
    expect(estimateTtl([hit(45), hit(120)])).toBeNull();
    expect(estimateTtl([hit(45), hit(120), hit(300)])).toBe(300 * MIN);
  });
  it("ignores hits at or beyond the shortest miss", () => {
    expect(estimateTtl([hit(45), hit(60), hit(90), miss(100), hit(400)])).toBe(90 * MIN);
    expect(estimateTtl([hit(45), hit(60), miss(50), hit(90)])).toBeNull();
  });
});

describe("addObservation", () => {
  it("keeps only the most recent observations", () => {
    let list: Observation[] = [];
    for (let i = 0; i < MAX_OBSERVATIONS + 5; i++) list = addObservation(list, hit(i + 10));
    expect(list).toHaveLength(MAX_OBSERVATIONS);
    expect(list[0]?.gapMs).toBe(15 * MIN);
  });
});

describe("summarize", () => {
  it("reports progress toward a learned lifetime", () => {
    expect(summarize([hit(45), miss(10)])).toEqual({ learnedMinutes: null, longGapHits: 0, longGapHitsNeeded: 3 });
    expect(summarize([hit(45)])).toEqual({ learnedMinutes: null, longGapHits: 1, longGapHitsNeeded: 3 });
    expect(summarize([hit(45), hit(60), hit(130)])).toEqual({
      learnedMinutes: 130,
      longGapHits: 3,
      longGapHitsNeeded: 3,
    });
  });
});

import { describe, expect, it } from "vitest";
import { formatAgo, formatDuration, formatTokens, minutesUntil, pluralMinutes } from "./format.js";

const MIN = 60_000;

describe("format", () => {
  it("formats token counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(412_300)).toBe("412K");
    expect(formatTokens(100_000)).toBe("100K");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
  it("formats durations and countdowns", () => {
    expect(minutesUntil(10 * MIN + 1, 0)).toBe(11);
    expect(minutesUntil(0, 5 * MIN)).toBe(0);
    expect(formatDuration(0)).toBe("under 1m");
    expect(formatDuration(23)).toBe("23m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(65)).toBe("1h 5m");
    expect(pluralMinutes(1)).toBe("1 minute");
    expect(pluralMinutes(12)).toBe("12 minutes");
  });
  it("formats elapsed time", () => {
    expect(formatAgo(0, 30_000)).toBe("just now");
    expect(formatAgo(0, 5 * MIN)).toBe("5m ago");
    expect(formatAgo(0, 61 * MIN)).toBe("1h ago");
    expect(formatAgo(0, 50 * 60 * MIN)).toBe("2d ago");
  });
});

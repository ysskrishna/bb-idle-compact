import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./policy.js";
import { parseStoredSettings } from "./server-settings.js";

describe("parseStoredSettings", () => {
  it("uses the approved defaults when nothing is stored", () => {
    expect(parseStoredSettings(undefined)).toEqual({
      enabled: true,
      warmIdle: true,
      coldReturn: true,
      threshold: 20,
      claudeThreshold: 0,
      codexThreshold: 0,
      codexTtlMinutes: 0,
      idleMarginMinutes: 5,
    });
  });
  it("keeps valid values and replaces only invalid ones", () => {
    const parsed = parseStoredSettings({ threshold: 35, idleMarginMinutes: 99, warmIdle: "yes", mode: "button" });
    expect(parsed.threshold).toBe(35);
    expect(parsed.idleMarginMinutes).toBe(DEFAULT_SETTINGS.idleMarginMinutes);
    expect(parsed.warmIdle).toBe(true);
    expect(parsed).not.toHaveProperty("mode");
  });
});

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULT_SETTINGS as D, type Settings } from "./policy.js";

const percent = z.number().int().min(0).max(100);

export function defineSettings(bb: BbPluginApi) {
  const handle = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Compact large idle threads around prompt cache expiry",
      default: D.enabled,
    },
    mode: {
      type: "select",
      label: "When you return after the cache expired",
      options: ["auto", "button"],
      experimental_optionLabels: {
        auto: "Compact first, then send (default)",
        button: "Only show the Compact button",
      },
      default: D.mode,
    },
    threshold: {
      type: "number",
      label: "Context threshold (% of the window, at least 100K tokens)",
      experimental_schema: percent.min(1),
      default: D.threshold,
    },
    warmIdle: {
      type: "boolean",
      label: "Advanced: compact idle threads just before the cache expires",
      default: D.warmIdle,
    },
    coldReturn: {
      type: "boolean",
      label: "Advanced: compact before sending when the cache already expired",
      default: D.coldReturn,
    },
    claudeThreshold: {
      type: "number",
      label: "Advanced: Claude Code threshold % (0 uses the global value)",
      experimental_schema: percent,
      default: D.claudeThreshold,
    },
    codexThreshold: {
      type: "number",
      label: "Advanced: Codex threshold % (0 uses the global value)",
      experimental_schema: percent,
      default: D.codexThreshold,
    },
    codexTtlMinutes: {
      type: "number",
      label:
        "Advanced: Codex cache lifetime in minutes (0 learns it, starting at 30)",
      experimental_schema: z.number().int().min(0).max(24 * 60),
      default: D.codexTtlMinutes,
    },
    idleMarginMinutes: {
      type: "number",
      label: "Advanced: compact idle threads this many minutes before expiry",
      experimental_schema: z.number().int().min(1).max(30),
      default: D.idleMarginMinutes,
    },
  });
  return {
    handle,
    async get(): Promise<Settings> {
      const v = await handle.get();
      return { ...v, mode: v.mode === "button" ? "button" : "auto" };
    },
  };
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { MAX_EVENT_PAGE, tokenUsage } from "./server-facts.js";

describe("tokenUsage", () => {
  it("never asks BB for more events than one page allows", async () => {
    const limits: string[] = [];
    const bb = {
      sdk: {
        threads: {
          events: {
            list: async ({ limit }: { limit: string }) => {
              limits.push(limit);
              return [];
            },
          },
        },
      },
    } as unknown as BbPluginApi;
    await tokenUsage(bb, "t1", 200);
    await tokenUsage(bb, "t1", 1);
    expect(limits).toEqual([String(MAX_EVENT_PAGE), "1"]);
    expect(MAX_EVENT_PAGE).toBe(100);
  });
});

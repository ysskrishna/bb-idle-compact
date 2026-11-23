// Installs the plugin on an isolated scratch BB and checks its RPCs end to
// end: default settings, saving and rejecting values, stats, and the status of
// a scheduled Codex thread that never ran a turn. No browser and no provider credentials needed.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startScratchServer } from "./server.mjs";

const server = await startScratchServer();
try {
  const call = async (method, input, { allowFailure = false } = {}) => {
    const file = join(server.scratch, `${method}-input.json`);
    writeFileSync(file, JSON.stringify(input));
    const result = await server.cli(
      ["plugin", "rpc", "call", "bb-idle-compact", method, "--input-file", file, "--json"],
      {
        allowFailure,
      },
    );
    return allowFailure ? result : JSON.parse(result.stdout);
  };

  assert.deepEqual(await call("get_settings", {}), {
    warmIdle: true,
    coldReturn: true,
    threshold: 20,
    claudeThreshold: 0,
    codexThreshold: 0,
    codexTtlMinutes: 0,
    idleMarginMinutes: 5,
  });
  assert.equal((await call("update_settings", { threshold: 30 })).threshold, 30);
  assert.equal((await call("get_settings", {})).threshold, 30);
  const rejected = await call("update_settings", { threshold: 0 }, { allowFailure: true });
  assert.notEqual(rejected.code, 0, "a threshold of 0% must be rejected");
  assert.equal((await call("get_settings", {})).threshold, 30);
  assert.deepEqual(await call("stats", {}), {
    compactions: 0,
    tokensNotReRead: 0,
    beforeExpiry: 0,
    onReturn: 0,
    manual: 0,
    codexTtl: { learnedMinutes: null, longGapHits: 0, longGapHitsNeeded: 3 },
  });

  const thread = await server.seed("Idle Compact smoke thread", { idle: true });
  assert.deepEqual(await call("thread_status", { threadId: thread.id }), { state: "none" });
  const compact = await call("compact_now", { threadId: thread.id });
  assert.equal(compact.ok, false, "an empty thread has nothing to compact");
  assert.equal(compact.message, "This thread's provider or context size is not known yet.");

  await server.checkIsolation("complete");
  console.log("PASS: settings, stats, status and compact_now behave on a scratch BB");
} catch (error) {
  await server.diagnostics();
  throw error;
} finally {
  await server.cleanup();
}

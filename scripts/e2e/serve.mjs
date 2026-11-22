// Keeps an isolated scratch BB with this plugin running for README captures.
// Usage: npm run e2e:serve -- [--openai-key-file <dotenv>] [--minutes 120]
// It writes e2e-artifacts/serve.json (URL, CLI path, project) and
// e2e-artifacts/serve.env (the scratch environment for the BB CLI; no
// secrets), then waits until the time is up or it is interrupted, and deletes
// all scratch data.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startScratchServer } from "./server.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const minutes = Number(option("--minutes") ?? 120);
const server = await startScratchServer({
  projectName: "Payments service",
  openaiKeyFile: option("--openai-key-file"),
});
try {
  writeFileSync(
    resolve("e2e-artifacts/serve.json"),
    JSON.stringify(
      { url: server.url, bb: server.bb, projectId: server.projectId, repo: server.repo, scratch: server.scratch },
      null,
      2,
    ),
  );
  // The scratch environment holds paths and ports only; the API key never enters it.
  writeFileSync(
    resolve("e2e-artifacts/serve.env"),
    `${Object.entries(server.env)
      .filter(([key]) => !/^npm_/i.test(key))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
  console.log(`SERVING: ${server.url} for ${minutes} minutes; details in e2e-artifacts/serve.json`);
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    await delay(5_000);
    await server.checkIsolation("monitor");
  }
} finally {
  await server.cleanup();
}

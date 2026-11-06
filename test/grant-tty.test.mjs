import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

test("grant refuses without TTY and without KEYLESS_AUTO_CONFIRM", async () => {
  const child = spawn(process.execPath, [resolve("bin/keyless.js"), "grant", "openai", "--provider", "openai", "--methods", "POST", "--paths", "/v1/chat/completions"], {
    env: { ...process.env, KEYLESS_AUTO_CONFIRM: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0, `expected non-zero exit, got ${code}`);
  assert.match(stderr, /requires a TTY|KEYLESS_AUTO_CONFIRM/i);
});

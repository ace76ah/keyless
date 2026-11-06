import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Vault } from "../dist/vault/vault.js";
import { createProxyServer } from "../dist/proxy/server.js";

function post(url, token) {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-api-key": "dummy-caller-key",
    },
    body: JSON.stringify({ model: "test-model" }),
  });
}
async function waitForDaemon(child) {
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText += chunk.toString(); });
  const exitPromise = once(child, "exit").then(([code, signal]) => {
    throw new Error(`daemon exited before ready (code ${code}, signal ${signal}): ${stderrText}`);
  });
  const readyPromise = (async () => {
    for await (const line of stdout) {
      let value;
      try { value = JSON.parse(line); }
      catch { throw new Error(`daemon emitted invalid startup output: ${line}`); }
      if (value.ready) return value;
      if (value.error) throw new Error(`daemon startup failed: ${value.error}`);
    }
    throw new Error(`daemon exited before becoming ready: ${stderrText}`);
  })();
  try { return await Promise.race([readyPromise, exitPromise]); }
  finally { stdout.close(); }
}

test("proxy validates real vault token and injects vault credential, rejects invalid token", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "keyless-proxy-"));
  const vaultPath = join(directory, "vault.json");
  const socketPath = join(directory, "daemon.sock");
  const passphrase = "proxy-integration-passphrase";
  const projectId = "123e4567-e89b-42d3-a456-426614174000";
  const token = `klp_v1_${Buffer.from("integration-test-token-material-32bytes").toString("base64url")}`;
  const vault = await Vault.create(vaultPath, passphrase);
  await vault.add("openai", "openai", "sk-vault-secret-only");
  await vault.addToken(
    projectId,
    token,
    new Date(Date.now() + 60_000).toISOString(),
    [{
      alias: "openai",
      provider: "openai",
      host: "api.openai.com",
      enabled: true,
      methods: ["POST"],
      paths: ["/v1/chat/completions"],
    }],
  );
  await vault.close();
  const serverPath = resolve("dist/daemon/server.js");
  const child = spawn(process.execPath, [serverPath, "--vault", vaultPath, "--socket", socketPath], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null && !child.killed) {
      try { child.kill("SIGTERM"); } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  });
  child.stdin.end(`${passphrase}\n`);
  const ready = await waitForDaemon(child);
  assert.ok(ready.ready);
  let captured;
  const proxy = await createProxyServer({
    socketPath,
    upstreamFetch: async (url, init) => {
      captured = { url, headers: new Headers(init.headers), body: init.body };
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  t.after(() => proxy.close());
  const base = `http://${proxy.address}:${proxy.port}/c/openai/v1/chat/completions`;
  const good = await post(base, token);
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { ok: true });
  assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(captured.headers.get("authorization"), "Bearer sk-vault-secret-only");
  assert.equal(captured.headers.get("x-api-key"), null);
  assert.equal(captured.headers.get("host"), null);
  const bad = await post(base, "klp_v1_invalid-token-material-long-enough");
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).code, "token_invalid");
});

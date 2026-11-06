import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Vault } from "../dist/vault/vault.js";
import { createProxyServer } from "../dist/proxy/server.js";

async function waitForDaemon(child) {
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText += chunk.toString(); });
  const exitPromise = once(child, "exit").then(([code, signal]) => {
    throw new Error(`daemon exited (${code}, ${signal}): ${stderrText}`);
  });
  const readyPromise = (async () => {
    for await (const line of stdout) {
      let value;
      try { value = JSON.parse(line); } catch { throw new Error(`invalid startup output: ${line}`); }
      if (value.ready) return value;
    }
    throw new Error(`daemon exited before ready: ${stderrText}`);
  })();
  try { return await Promise.race([readyPromise, exitPromise]); }
  finally { stdout.close(); }
}

const TRAVERSALS = [
  "/v1/chat/completions/../../v1/models",
  "/v1/chat/completions/%2e%2e/%2e%2e/v1/models",
  "/v1/chat/completions/..%2fv1%2fmodels",
  "/v1/chat/completions/./../../../etc/passwd",
  "/v1/chat/completions%2f..%2fmodels",
  "/v1/chat/completions/%252e%252e/%252e%252e/v1/models",
];

test("path traversal never reaches upstream", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "keyless-trav-"));
  const vaultPath = join(dir, "vault.json");
  const socketPath = join(dir, "daemon.sock");
  const passphrase = "traversal-test-passphrase";
  const projectId = "123e4567-e89b-42d3-a456-426614174000";
  const token = `klp_v1_${Buffer.from("traversal-test-token-material-32bytes").toString("base64url")}`;

  const vault = await Vault.create(vaultPath, passphrase);
  await vault.add("openai", "openai", "sk-vault-secret-only");
  await vault.addToken(projectId, token, new Date(Date.now() + 3_600_000).toISOString(), [{
    alias: "openai", provider: "openai", host: "api.openai.com", enabled: true,
    methods: ["POST"], paths: ["/v1/chat/completions"],
  }]);
  await vault.close();

  const child = spawn(process.execPath, [resolve("dist/daemon/server.js"), "--vault", vaultPath, "--socket", socketPath], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null) try { child.kill("SIGTERM"); } catch {} await rm(dir, { recursive: true, force: true }); });
  child.stdin.end(`${passphrase}\n`);
  await waitForDaemon(child);

  let captured = null;
  const proxy = await createProxyServer({
    socketPath,
    upstreamFetch: async (url, init) => {
      captured = { url, headers: new Headers(init.headers) };
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  t.after(() => proxy.close());

  for (const badPath of TRAVERSALS) {
    captured = null;
    const res = await fetch(`http://${proxy.address}:${proxy.port}/c/openai${badPath}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.notEqual(res.status, 200, `traversal ${badPath} must not return 200, got ${res.status}`);
    assert.equal(captured, null, `upstream must not be reached for ${badPath}`);
  }

  captured = null;
  const ok = await fetch(`http://${proxy.address}:${proxy.port}/c/openai/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(ok.status, 200);
  assert.ok(captured);
  assert.equal(new URL(captured.url).pathname, "/v1/chat/completions");
  assert.equal(captured.headers.get("authorization"), "Bearer sk-vault-secret-only");
  assert.equal(captured.headers.get("x-api-key"), null);
});

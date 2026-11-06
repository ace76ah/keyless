import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createInterface } from "node:readline";
import net from "node:net";
import { Vault } from "../dist/vault/vault.js";
import { createProxyServer } from "../dist/proxy/server.js";
import { resolveIpcAddress } from "../dist/daemon/ipc.js";

async function waitForDaemon(child) {
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText += chunk.toString(); });
  const exitPromise = once(child, "exit").then(([code, signal]) => { throw new Error(`daemon exited (${code}, ${signal}): ${stderrText}`); });
  const readyPromise = (async () => {
    for await (const line of stdout) {
      let value;
      try { value = JSON.parse(line); } catch { throw new Error(`invalid startup output: ${line}`); }
      if (value.ready) return value;
    }
    throw new Error(`daemon exited before ready: ${stderrText}`);
  })();
  try { return await Promise.race([readyPromise, exitPromise]); } finally { stdout.close(); }
}

function ipcRequest(socketPath, command, args = {}) {
  return new Promise((resolveResult, reject) => {
    const socket = net.createConnection(resolveIpcAddress(socketPath));
    let buffer = "";
    socket.once("connect", () => socket.write(`${JSON.stringify({ command, args })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        const res = JSON.parse(buffer.slice(0, newline));
        if (!res.ok) reject(new Error(res.error));
        else resolveResult(res.data);
      } catch (err) { reject(err); }
    });
    socket.once("error", reject);
  });
}

test("revoked token is rejected immediately without restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "keyless-revoke-"));
  const vaultPath = join(dir, "vault.json");
  const socketPath = join(dir, "daemon.sock");
  const passphrase = "revoke-test-passphrase";
  const projectId = "123e4567-e89b-42d3-a456-426614174000";
  const token = `klp_v1_${Buffer.from("revoke-test-token-material-32bytes").toString("base64url")}`;

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

  const proxy = await createProxyServer({
    socketPath,
    upstreamFetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  t.after(() => proxy.close());

  const before = await fetch(`http://${proxy.address}:${proxy.port}/c/openai/v1/chat/completions`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}",
  });
  assert.equal(before.status, 200);

  await ipcRequest(socketPath, "revoke", { projectId });

  const after = await fetch(`http://${proxy.address}:${proxy.port}/c/openai/v1/chat/completions`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}",
  });
  assert.notEqual(after.status, 200);
});

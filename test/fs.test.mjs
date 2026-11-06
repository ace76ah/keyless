import { strict as assert } from "node:assert";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { realFs } from "../src/vault/fs.ts";

test("writeFileTmp and fsyncAndRename move content to the final path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keyless-fs-"));
  const tmp = path.join(dir, "vault.tmp");
  const final = path.join(dir, "vault.json");
  try {
    await realFs.writeFileTmp(tmp, Buffer.from("keyless-test"), 0o600);
    await realFs.fsyncAndRename(tmp, final);
    assert.equal(await readFile(final, "utf8"), "keyless-test");
    await assert.rejects(stat(tmp), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFileTmp applies mode 0600 on POSIX", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keyless-fs-"));
  const file = path.join(dir, "vault.tmp");
  try {
    await realFs.writeFileTmp(file, Buffer.from("secret"), 0o600);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unlink ignores a nonexistent path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keyless-fs-"));
  try {
    await assert.doesNotReject(realFs.unlink(path.join(dir, "missing")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

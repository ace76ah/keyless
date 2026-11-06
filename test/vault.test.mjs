import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WrongPassphraseError, VaultVersionError, VaultConflictError, VaultFormatError, KdfParamsError } from "../src/vault/errors.ts";

const PASS = "correct horse battery staple";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keyless-vault-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "vault.json");
}

async function api() {
  return import("../src/vault/vault.ts");
}

async function readEnvelope(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeEnvelope(file, envelope) {
  await writeFile(file, JSON.stringify(envelope, null, 2) + "\n", { mode: 0o600 });
}

test("create, list, add, close, and reopen preserve credentials", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  assert.deepEqual(await vault.list(), []);
  await vault.add("openai", "openai", "sk-test-openai");
  assert.deepEqual(await vault.list(), ["openai"]);
  await vault.close();
  const reopened = await Vault.open(file, PASS);
  assert.deepEqual(await reopened.list(), ["openai"]);
  await reopened.close();
});

test("open with the correct passphrase returns the credential names", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.add("openai", "openai", "sk-test");
  await vault.close();
  const reopened = await Vault.open(file, PASS);
  assert.deepEqual(await reopened.list(), ["openai"]);
  await reopened.close();
});

test("open with a wrong passphrase throws WrongPassphraseError", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  await assert.rejects(() => Vault.open(file, "wrong"), WrongPassphraseError);
});

test("corrupt ciphertext throws WrongPassphraseError", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  const buf = Buffer.from(env.payload.ciphertext, "base64");
  buf[0] ^= 0xff;
  env.payload.ciphertext = buf.toString("base64");
  await writeEnvelope(file, env);
  await assert.rejects(() => Vault.open(file, PASS), WrongPassphraseError);
});

test("corrupt authentication tag throws the exact WrongPassphraseError class", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  const buf = Buffer.from(env.payload.tag, "base64");
  buf[0] ^= 0xff;
  env.payload.tag = buf.toString("base64");
  await writeEnvelope(file, env);
  await assert.rejects(() => Vault.open(file, PASS), WrongPassphraseError);
});

test("truncated file throws VaultFormatError", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const raw = await readFile(file, "utf8");
  await writeFile(file, raw.slice(0, raw.length / 2));
  await assert.rejects(() => Vault.open(file, PASS), VaultFormatError);
});

test("malformed JSON throws VaultFormatError", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  await writeFile(file, "not json");
  await assert.rejects(() => Vault.open(file, PASS), VaultFormatError);
});

test("invalid base64 salt throws VaultFormatError before KDF", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  env.kdf.salt = "not-base64!!";
  await writeEnvelope(file, env);
  const start = Date.now();
  await assert.rejects(() => Vault.open(file, PASS), VaultFormatError);
  assert.ok(Date.now() - start < 100, "KDF should not have run");
});

test("KDF memory below floor throws before allocation", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  env.kdf.m = 1024;
  await writeEnvelope(file, env);
  const start = Date.now();
  await assert.rejects(() => Vault.open(file, PASS), (err) => err.name === "KdfParamsError" || err.name === "VaultFormatError");
  assert.ok(Date.now() - start < 100, "KDF should not have run");
});

test("KDF memory above ceiling throws before allocation", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  env.kdf.m = 2097152;
  await writeEnvelope(file, env);
  const start = Date.now();
  await assert.rejects(() => Vault.open(file, PASS), (err) => err.name === "KdfParamsError" || err.name === "VaultFormatError");
  assert.ok(Date.now() - start < 100, "KDF should not have run");
});

test("tampered kdf params are detected by AAD", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  env.kdf.m = 65537; // one byte change
  await writeEnvelope(file, env);
  await assert.rejects(() => Vault.open(file, PASS), WrongPassphraseError);
});

test("tampered vaultId is detected by AAD", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  const buf = Buffer.from(env.vaultId, "base64");
  buf[0] ^= 0xff;
  env.vaultId = buf.toString("base64");
  await writeEnvelope(file, env);
  await assert.rejects(() => Vault.open(file, PASS), WrongPassphraseError);
});

test("tampered generation is detected by AAD", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  env.generation = "1";
  await writeEnvelope(file, env);
  await assert.rejects(() => Vault.open(file, PASS), WrongPassphraseError);
});

test("stale generation writer is rejected", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vaultA = await Vault.create(file, PASS);
  const vaultB = await Vault.open(file, PASS);
  await vaultA.add("a", "p", "s");
  await assert.rejects(() => vaultB.add("b", "p", "s"), VaultConflictError);
});

test("created vault file has mode 0600 on POSIX", async (t) => {
  if (process.platform === "win32") return t.skip("skip on windows");
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const { stat } = await import("node:fs/promises");
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("newer format version throws VaultVersionError", async (t) => {
  const file = await fixture(t);
  const { Vault } = await api();
  const vault = await Vault.create(file, PASS);
  await vault.close();
  const env = await readEnvelope(file);
  env.version = 2;
  await writeEnvelope(file, env);
  await assert.rejects(() => Vault.open(file, PASS), VaultVersionError);
});

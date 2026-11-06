import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Vault } from '../src/vault/vault.ts';
import { realFs } from '../src/vault/fs.ts';
import { parseVault } from '../src/vault/format.ts';

test('failed atomic replacement leaves disk and memory unchanged', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'keyless-failed-write-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'vault.json');
  const initial = await Vault.create(file, 'correct horse battery staple');
  await initial.add('openai', 'openai', 'sk-before');
  await initial.close();

  let failNext = true;
  const injectedFs = {
    ...realFs,
    async fsyncAndRename(tmp, final) {
      if (failNext) { failNext = false; throw new Error('simulated rename failure'); }
      return realFs.fsyncAndRename(tmp, final);
    },
  };
  const vault = await Vault.open(file, 'correct horse battery staple', injectedFs);
  const beforeGeneration = vault.generation;
  const beforeList = await vault.list();
  const beforeDisk = await readFile(file);

  await assert.rejects(() => vault.add('anthropic', 'anthropic', 'sk-failed'), /simulated rename failure/);
  assert.deepEqual(await readFile(file), beforeDisk);
  assert.equal(vault.generation, beforeGeneration);
  assert.deepEqual(await vault.list(), beforeList);
  const diskEnvelope = parseVault(await realFs.readFile(file));
  assert.equal(diskEnvelope.generation, beforeGeneration.toString());

  await vault.add('anthropic', 'anthropic', 'sk-after');
  const reopened = await Vault.open(file, 'correct horse battery staple');
  assert.deepEqual(await reopened.list(), ['openai', 'anthropic']);
  assert.equal(reopened.generation, beforeGeneration + 1n);
  await reopened.close();
  await vault.close();
});

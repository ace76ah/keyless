import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, verifyAuditLog, readAuditEvents } from '../src/daemon/audit.ts';

const event = (status = 200) => ({
  projectId: 'project-test',
  alias: 'openai',
  method: 'POST',
  host: 'api.openai.com',
  path: '/v1/responses',
  status,
  durationMs: 42,
});

test('audit log appends a verifiable hash chain without request secrets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keyless-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'audit.log');
  const audit = new AuditLog(path);
  await audit.appendProxyRequest(event());
  await audit.appendProxyRequest(event(401));
  const verified = await verifyAuditLog(path);
  assert.equal(verified.sequence, 2);
  const events = await readAuditEvents(path);
  assert.equal(events.length, 2);
  const raw = await readFile(path, 'utf8');
  assert.doesNotMatch(raw, /Authorization|secret|body|headers/i);
});

test('audit verification detects a changed line', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keyless-audit-change-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'audit.log');
  const audit = new AuditLog(path);
  await audit.appendProxyRequest(event());
  const raw = await readFile(path, 'utf8');
  const changed = raw.replace('/v1/responses', '/v1/models');
  await writeFile(path, changed);
  await assert.rejects(() => verifyAuditLog(path), /integrity|checkpoint/i);
});

test('audit verification detects deletion of a line, including the tail', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keyless-audit-delete-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'audit.log');
  const audit = new AuditLog(path);
  await audit.appendProxyRequest(event());
  await audit.appendProxyRequest(event(401));
  const raw = await readFile(path, 'utf8');
  await writeFile(path, raw.split('\n').filter(Boolean).slice(0, 1).join('\n') + '\n');
  await assert.rejects(() => verifyAuditLog(path), /integrity|checkpoint/i);
});

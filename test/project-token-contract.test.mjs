import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';

const secrets = {
  openai: 'upstream-openai-secret-test-only',
  anthropic: 'upstream-anthropic-secret-test-only'
};
const digest = value => createHash('sha256').update(value, 'utf8').digest();
const matchesToken = (value, record) => {
  if (typeof value !== 'string' || !record || !record.digest) return false;
  const candidate = digest(value);
  return candidate.length === record.digest.length && timingSafeEqual(candidate, record.digest);
};
const sendError = (res, status, code, message, action) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: code, code, message, action }));
};

// Test-only reference fixture. This is not the production Keyless daemon.
function createHarness() {
  const token = 'klp_v1_' + randomBytes(32).toString('base64url');
  const records = new Map([['project-1', {
    digest: digest(token), expiresAt: Date.now() + 60_000,
    revoked: false, grants: new Set(['openai', 'anthropic'])
  }]]);
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      upstreamRequests.push({
        method: req.method, url: req.url, headers: { ...req.headers },
        body: Buffer.concat(chunks).toString('utf8')
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const proxy = http.createServer(async (req, res) => {
    const match = req.url.match(/^\/c\/(openai|anthropic)(\/.*)$/);
    if (!match) return sendError(res, 404, 'unknown_alias', 'The alias is not configured.', 'Check the configured alias.');
    const alias = match[1];
    const record = records.get('project-1');
    const auth = req.headers.authorization;
    const presented = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!matchesToken(presented, record) || record.revoked || record.expiresAt <= Date.now()) {
      return sendError(res, 401, 'token_invalid', 'The project token is invalid or expired.', 'Re-authorize this project.');
    }
    if (!record.grants.has(alias)) {
      return sendError(res, 403, 'forbidden_host', 'This project is not approved for this provider.', 'Review the project grant.');
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (['authorization', 'x-api-key', 'host', 'cookie', 'proxy-authorization', 'forwarded', 'via'].includes(name)) continue;
      if (name.startsWith('x-forwarded-')) continue;
      headers[name] = value;
    }
    if (alias === 'openai') headers.authorization = 'Bearer ' + secrets.openai;
    else headers['x-api-key'] = secrets.anthropic;
    const upstreamResponse = await fetch('http://127.0.0.1:' + upstream.address().port + match[2], {
      method: req.method, headers, body: Buffer.concat(chunks), redirect: 'manual'
    });
    res.writeHead(upstreamResponse.status, { 'content-type': 'application/json' });
    res.end(await upstreamResponse.text());
  });
  return { token, records, upstream, proxy, upstreamRequests };
}

let fixture;
let baseUrl;
before(async () => {
  fixture = createHarness();
  fixture.upstream.listen(0, '127.0.0.1');
  await once(fixture.upstream, 'listening');
  fixture.proxy.listen(0, '127.0.0.1');
  await once(fixture.proxy, 'listening');
  baseUrl = 'http://127.0.0.1:' + fixture.proxy.address().port;
});
after(async () => {
  for (const server of [fixture.proxy, fixture.upstream]) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

async function post(alias, headers = {}, body = { hello: 'world' }) {
  const path = alias === 'openai' ? '/v1/responses' : '/v1/messages';
  return fetch(baseUrl + '/c/' + alias + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('OpenAI bearer is replaced with the vault-held provider credential', async () => {
  const response = await post('openai', {
    authorization: 'Bearer ' + fixture.token,
    'x-api-key': 'caller-placeholder-not-a-secret',
    cookie: 'session=must-not-forward', 'x-forwarded-for': '203.0.113.10'
  });
  assert.equal(response.status, 200);
  const received = fixture.upstreamRequests.at(-1);
  assert.equal(received.url, '/v1/responses');
  assert.equal(received.headers.authorization, 'Bearer ' + secrets.openai);
  assert.equal(received.headers['x-api-key'], undefined);
  assert.equal(received.headers.cookie, undefined);
  assert.equal(received.headers['x-forwarded-for'], undefined);
  assert.equal(received.headers.authorization.includes(fixture.token), false);
});

test('Anthropic bearer and placeholder x-api-key are replaced', async () => {
  const response = await post('anthropic', {
    authorization: 'Bearer ' + fixture.token,
    'x-api-key': 'keyless-placeholder-not-a-secret',
    'anthropic-version': '2023-06-01'
  });
  assert.equal(response.status, 200);
  const received = fixture.upstreamRequests.at(-1);
  assert.equal(received.url, '/v1/messages');
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.headers['x-api-key'], secrets.anthropic);
  assert.equal(received.headers['anthropic-version'], '2023-06-01');
  assert.equal(received.headers['x-api-key'].includes(fixture.token), false);
});

test('missing, malformed and incorrect tokens fail with stable 401 errors', async () => {
  for (const authorization of [undefined, 'Basic abc', 'Bearer klp_v1_invalid']) {
    const response = await post('openai', authorization ? { authorization } : {});
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error, 'token_invalid');
    assert.equal(body.code, 'token_invalid');
    assert.ok(body.message);
    assert.ok(body.action);
  }
});

test('revoked and expired tokens fail closed', async () => {
  const record = fixture.records.get('project-1');
  record.revoked = true;
  let response = await post('openai', { authorization: 'Bearer ' + fixture.token });
  assert.equal(response.status, 401);
  record.revoked = false;
  record.expiresAt = Date.now() - 1;
  response = await post('openai', { authorization: 'Bearer ' + fixture.token });
  assert.equal(response.status, 401);
  record.expiresAt = Date.now() + 60_000;
});

test('unapproved provider is denied before upstream work', async () => {
  const record = fixture.records.get('project-1');
  record.grants.delete('anthropic');
  const beforeCount = fixture.upstreamRequests.length;
  const response = await post('anthropic', { authorization: 'Bearer ' + fixture.token });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, 'forbidden_host');
  assert.equal(fixture.upstreamRequests.length, beforeCount);
  record.grants.add('anthropic');
});

test('error bodies do not disclose provider credentials or the project token', async () => {
  const response = await post('openai', { authorization: 'Bearer wrong-token' });
  const body = await response.text();
  assert.equal(body.includes(secrets.openai), false);
  assert.equal(body.includes(fixture.token), false);
});

test('token record stores a digest and no plaintext token field', () => {
  const record = fixture.records.get('project-1');
  assert.equal(record.digest.length, 32);
  assert.equal(Object.hasOwn(record, 'token'), false);
  assert.equal(Object.hasOwn(record, 'plaintext'), false);
  assert.equal(matchesToken(fixture.token, record), true);
});

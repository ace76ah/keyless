import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createMockProxyServer } from '../spike/mock-proxy.mjs';

let server;
let baseUrl;

before(async () => {
  server = createMockProxyServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('health endpoint makes the mock-only boundary explicit', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, 'mock-only');
  assert.equal(body.credentialsStored, false);
  assert.equal(body.upstreamCalls, false);
});

test('path alias returns a canned OpenAI-shaped response', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-key' },
    body: JSON.stringify({ model: 'gpt-4.1-mini', input: 'hello' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.id, 'resp_keyless_mock');
  assert.match(body.output[0].content[0].text, /No provider was contacted/);
  assert.equal(response.headers.get('x-keyless-alias-mode'), 'path');
  assert.equal(response.headers.get('x-keyless-spike'), 'mock-only');
  assert.doesNotMatch(JSON.stringify(body), /local-spike-placeholder|not-a-real-key/);
});

test('header alias returns a canned Anthropic-shaped response', async () => {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-keyless-credential': 'anthropic', 'x-api-key': 'not-a-real-key' },
    body: JSON.stringify({ model: 'claude-test', max_tokens: 20, messages: [{ role: 'user', content: 'hello' }] })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.type, 'message');
  assert.equal(body.id, 'msg_keyless_mock');
  assert.equal(response.headers.get('x-keyless-alias-mode'), 'header');
  assert.doesNotMatch(JSON.stringify(body), /local-spike-placeholder|not-a-real-key/);
});

test('conflicting path and header aliases are rejected', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-keyless-credential': 'anthropic' },
    body: '{}'
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'alias_conflict');
});

test('unknown aliases are rejected', async () => {
  const response = await fetch(`${baseUrl}/c/not-a-provider/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error, 'unknown_alias');
});

test('unsupported provider routes are rejected', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/admin`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'unsupported_route');
});

test('OpenAI mock can return a small SSE stream', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4.1-mini', stream: true, messages: [{ role: 'user', content: 'hello' }] })
  });
  const body = await response.text();
  assert.equal(response.headers.get('content-type').split(';')[0], 'text/event-stream');
  assert.match(body, /chat\.completion\.chunk/);
  assert.match(body, /\[DONE\]/);
});

test('Anthropic mock can return a small SSE stream', async () => {
  const response = await fetch(`${baseUrl}/c/anthropic/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-test', stream: true, messages: [{ role: 'user', content: 'hello' }] })
  });
  const body = await response.text();
  assert.equal(response.headers.get('content-type').split(';')[0], 'text/event-stream');
  assert.match(body, /event: message_start/);
  assert.match(body, /event: content_block_delta/);
  assert.match(body, /event: message_stop/);
});


test('missing aliases return an actionable error', async () => {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_alias');
});

test('malformed JSON is rejected', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json'
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_json');
});

test('request bodies above the spike limit are rejected', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'x'.repeat(1024 * 1024 + 1) })
  });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error, 'body_too_large');
});

test('non-POST provider requests are rejected', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`);
  assert.equal(response.status, 405);
});

test('non-local Host headers are rejected', async () => {
  const { port } = new URL(baseUrl);
  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/health',
      method: 'GET',
      headers: { Host: 'not-local.example' },
      agent: false
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({
        status: incoming.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    request.on('error', reject);
    request.end();
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'invalid_host');
});

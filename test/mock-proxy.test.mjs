import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
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

test('non-null browser origins are rejected, including preflight requests', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example' }
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error, 'origin_not_allowed');
});

test('the literal null Origin value is not rejected by the origin guard', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`, {
    method: 'POST',
    headers: { origin: 'null', 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 200);
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

async function assertIncrementalSse(path, requestBody, firstFramePattern, lastFramePattern) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type').split(';')[0], 'text/event-stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  let firstFrame = '';

  while (!firstFrame && !received.includes('\n\n')) {
    const { value, done } = await reader.read();
    assert.equal(done, false, 'stream ended before its first frame');
    received += decoder.decode(value, { stream: true });
    const frameEnd = received.indexOf('\n\n');
    if (frameEnd !== -1) firstFrame = received.slice(0, frameEnd + 2);
  }

  assert.match(firstFrame, firstFramePattern);
  assert.doesNotMatch(received, lastFramePattern, 'the final frame must not arrive with the first frame');

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  received += decoder.decode();
  assert.match(received, lastFramePattern);
}

test('OpenAI mock streams the first SSE frame before the final frame', async () => {
  await assertIncrementalSse(
    '/c/openai/v1/chat/completions',
    { model: 'gpt-4.1-mini', stream: true, messages: [{ role: 'user', content: 'hello' }] },
    /chat\.completion\.chunk/,
    /\[DONE\]/
  );
});

test('Anthropic mock streams the first SSE frame before the final frame', async () => {
  await assertIncrementalSse(
    '/c/anthropic/v1/messages',
    { model: 'claude-test', stream: true, messages: [{ role: 'user', content: 'hello' }] },
    /event: message_start/,
    /event: message_stop/
  );
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

test('request bodies above the spike limit get a 413 and the connection closes', async () => {
  const { port } = new URL(baseUrl);
  const result = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/c/openai/v1/responses',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': 2 * 1024 * 1024
      },
      agent: false
    });
    let socketClosed = false;
    let responseResult = null;

    const finishIfClosed = () => {
      if (socketClosed && responseResult) resolve({ ...responseResult, socketClosed });
    };

    request.on('socket', (socket) => {
      socket.once('close', () => {
        socketClosed = true;
        finishIfClosed();
      });
    });
    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        responseResult = {
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
        };
        finishIfClosed();
      });
    });
    request.on('error', (error) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    request.write(Buffer.alloc(1024 * 1024 + 1, 120));
  });

  assert.equal(result.status, 413);
  assert.equal(result.body.error, 'body_too_large');
  assert.equal(result.socketClosed, true);
});

test('non-POST provider requests are rejected', async () => {
  const response = await fetch(`${baseUrl}/c/openai/v1/responses`);
  assert.equal(response.status, 405);
});

test('Host: evil.example is rejected as invalid_host', async () => {
  const { port } = new URL(baseUrl);
  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/health',
      method: 'GET',
      headers: { Host: 'evil.example' },
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

function waitForSocketClose(port, requestText) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1');
    let response = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('The stalled request socket did not close in time.'));
    }, 8_000);

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(requestText));
    socket.on('data', (chunk) => {
      response += chunk;
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      resolve(response);
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test('explicit request and header timeouts close stalled bodies and headers', async () => {
  assert.equal(server.requestTimeout, 5_000);
  assert.equal(server.headersTimeout, 5_000);
  assert.equal(server.connectionsCheckingInterval, 1_000);

  const { port } = new URL(baseUrl);
  const bodyResponse = await waitForSocketClose(port, [
    'POST /c/openai/v1/responses HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Content-Type: application/json',
    'Content-Length: 20',
    'Connection: close',
    '',
    '{}'
  ].join('\r\n'));
  assert.match(bodyResponse, /^HTTP\/1\.1 408 Request Timeout/m);

  const headersResponse = await waitForSocketClose(port, [
    'POST /c/openai/v1/responses HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Content-Type: application/json'
  ].join('\r\n'));
  assert.match(headersResponse, /^HTTP\/1\.1 408 Request Timeout/m);
});

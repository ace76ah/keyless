#!/usr/bin/env node

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// The spike binds IPv4 loopback only; production must deliberately support and test 127.0.0.1 and ::1.
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const REQUEST_TIMEOUT_MS = 5_000;
const HEADERS_TIMEOUT_MS = 5_000;
const TIMEOUT_CHECK_INTERVAL_MS = 1_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MOCK_TEXT = 'This is a Keyless mock response. No provider was contacted.';

const routes = {
  openai: new Set(['/v1/responses', '/v1/chat/completions']),
  anthropic: new Set(['/v1/messages'])
};

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-keyless-spike': 'mock-only',
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function routeRequest(request) {
  const url = new URL(request.url || '/', `http://${HOST}`);
  const pathMatch = /^\/c\/([^/]+)(\/.*)?$/.exec(url.pathname);
  let pathAlias = null;

  try {
    pathAlias = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  } catch {
    return { error: ['invalid_alias', 'The alias contains invalid URL encoding.'] };
  }

  const headerValue = request.headers['x-keyless-credential'];
  const headerAlias = typeof headerValue === 'string' ? headerValue.trim() : null;

  if (pathAlias && headerAlias && pathAlias !== headerAlias) {
    return { error: ['alias_conflict', 'The path alias and header alias do not match.'] };
  }

  const alias = pathAlias || headerAlias;
  const upstreamPath = pathMatch ? (pathMatch[2] || '/') : url.pathname;
  const mode = pathAlias ? 'path' : 'header';

  if (!alias) return { error: ['missing_alias', 'Use /c/<alias>/... or X-Keyless-Credential.'] };
  if (!Object.hasOwn(routes, alias)) return { error: ['unknown_alias', 'This mock only knows openai and anthropic.'] };
  if (!routes[alias].has(upstreamPath)) return { error: ['unsupported_route', 'This provider route is not part of the spike.'] };

  return { alias, mode, upstreamPath };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };

    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        cleanup();
        request.pause();
        resolve({ tooLarge: true, value: null });
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();
      if (chunks.length === 0) {
        resolve({ tooLarge: false, value: {} });
        return;
      }

      try {
        resolve({ tooLarge: false, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ tooLarge: false, invalidJson: true, value: null });
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onAborted = () => {
      cleanup();
      reject(new Error('Request body was aborted by the client.'));
    };

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

function openAIResponse(path) {
  if (path === '/v1/chat/completions') {
    return {
      id: 'chatcmpl_keyless_mock',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4.1-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: MOCK_TEXT }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 12, total_tokens: 13 }
    };
  }

  return {
    id: 'resp_keyless_mock',
    object: 'response',
    created_at: 0,
    status: 'completed',
    error: null,
    model: 'gpt-4.1-mini',
    output: [{
      id: 'msg_keyless_mock',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: MOCK_TEXT, annotations: [] }]
    }]
  };
}

function anthropicResponse() {
  return {
    id: 'msg_keyless_mock',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text: MOCK_TEXT }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 12 }
  };
}

async function sendSse(response, alias) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    'connection': 'keep-alive',
    'x-keyless-spike': 'mock-only'
  });

  const frames = alias === 'anthropic'
    ? [
        ['message_start', { type: 'message_start', message: { id: 'msg_keyless_mock', type: 'message', role: 'assistant', content: [], model: 'claude-test', usage: { input_tokens: 1, output_tokens: 0 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: MOCK_TEXT } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } }],
        ['message_stop', { type: 'message_stop' }]
      ]
    : [
        [null, { id: 'chatcmpl_keyless_mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: MOCK_TEXT }, finish_reason: null }] }],
        [null, { id: 'chatcmpl_keyless_mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]
      ];

  for (const [event, data] of frames) {
    if (response.destroyed) return;
    if (event) response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (alias === 'openai') response.write('data: [DONE]\n\n');
  response.end();
}

async function handleRequest(request, response, server, verbose, requestId) {
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== 'null') {
    json(response, 403, { error: 'origin_not_allowed', message: 'Browser-origin requests are not supported by this spike.' });
    request.resume();
    return;
  }

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;

  // Convenience check only: Host can be spoofed by a local client; this is not authentication or a security boundary.
  const acceptedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  if (!acceptedHosts.has(request.headers.host)) {
    json(response, 400, { error: 'invalid_host', message: 'The mock only accepts its local Host header.' });
    request.resume();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, { ok: true, mode: 'mock-only', credentialsStored: false, upstreamCalls: false });
    return;
  }

  if (request.method !== 'POST') {
    json(response, 405, { error: 'method_not_allowed', message: 'Use POST for mock provider requests.' }, { allow: 'GET, POST' });
    request.resume();
    return;
  }

  const route = routeRequest(request);
  if (route.error) {
    const [code, message] = route.error;
    const status = code === 'unknown_alias' ? 404 : 400;
    json(response, status, { error: code, message });
    request.resume();
    return;
  }

  const body = await readBody(request);
  if (body.tooLarge) {
    // Send the bounded error response first, then close the socket instead of draining an unbounded body.
    response.once('finish', () => request.destroy());
    json(response, 413, { error: 'body_too_large', message: 'The spike accepts request bodies up to 1 MiB.' });
    return;
  }
  if (body.invalidJson) {
    json(response, 400, { error: 'invalid_json', message: 'Send a JSON request body.' });
    return;
  }

  if (verbose) {
    process.stderr.write(`[spike:${String(requestId).padStart(6, '0')}] ${request.method} ${route.alias} ${route.upstreamPath} alias=${route.mode}\n`);
  }

  if (body.value?.stream === true && route.upstreamPath === '/v1/chat/completions' && route.alias === 'openai') {
    await sendSse(response, 'openai');
    return;
  }
  if (body.value?.stream === true && route.alias === 'anthropic') {
    await sendSse(response, 'anthropic');
    return;
  }

  const result = route.alias === 'openai'
    ? openAIResponse(route.upstreamPath)
    : anthropicResponse();
  json(response, 200, result, { 'x-keyless-alias-mode': route.mode });
}

export function createMockProxyServer({ verbose = false } = {}) {
  let server;
  let nextRequestId = 0;
  server = http.createServer((request, response) => {
    const requestId = ++nextRequestId;
    void handleRequest(request, response, server, verbose, requestId).catch(() => {
      if (!response.headersSent) {
        json(response, 500, { error: 'mock_error', message: 'The local mock could not complete the request.' });
      } else {
        response.destroy();
      }
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.connectionsCheckingInterval = TIMEOUT_CHECK_INTERVAL_MS;
  return server;
}

function start() {
  // This environment variable selects the local port; it is not an authentication mechanism.
  const port = Number(process.env.KEYLESS_SPIKE_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('KEYLESS_SPIKE_PORT must be a valid TCP port.');
  }

  const server = createMockProxyServer({ verbose: process.argv.includes('--verbose') });
  server.listen(port, HOST, () => {
    process.stdout.write(`Keyless Gate -1 mock listening at http://${HOST}:${port}\n`);
    process.stdout.write('Mock only: no credentials are stored, attached, or forwarded.\n');
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) start();

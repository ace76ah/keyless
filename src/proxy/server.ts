import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import { resolveIpcAddress } from '../daemon/ipc.ts';

export type ProxyOptions = {
  socketPath: string;
  host?: string;
  port?: number;
  upstreamFetch?: typeof fetch;
  maxRequestBytes?: number;
};
export type ProxyHandle = { address: string; port: number; close(): Promise<void> };
const PROVIDERS: Record<string, { host: string; authHeader: string; prefix: string }> = {
  openai: { host: 'api.openai.com', authHeader: 'authorization', prefix: 'Bearer ' },
  anthropic: { host: 'api.anthropic.com', authHeader: 'x-api-key', prefix: '' },
};

async function ipcRequest(address: string, command: string, args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address); let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon IPC timeout')); }, 5000);
    socket.once('connect', () => socket.write(`${JSON.stringify({ command, args })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8'); const newline = buffer.indexOf('\n'); if (newline < 0) return;
      clearTimeout(timer); socket.end();
      try { const response = JSON.parse(buffer.slice(0, newline)); if (!response.ok) reject(new Error(response.error || 'daemon request failed')); else resolve(response.data); }
      catch (error) { reject(error); }
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
function reply(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: code, code, message }));
}
function safePath(raw: string): { alias: string; upstreamPath: string } | null {
  if (!raw.startsWith('/') || raw.startsWith('//') || /[%\\\\\0]/.test(raw) || /(^|\/)\.{1,2}(\/|$)/.test(raw)) return null;
  const match = /^\/c\/([a-z][a-z0-9_-]{0,31})(\/.*)?$/.exec(raw);
  if (!match) return null;
  return { alias: match[1], upstreamPath: match[2] || '/' };
}
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += value.length; if (size > limit) throw new Error('body_too_large'); chunks.push(value); }
  return Buffer.concat(chunks);
}

export async function createProxyServer(options: ProxyOptions): Promise<ProxyHandle> {
  const host = options.host ?? '127.0.0.1'; const maxBytes = options.maxRequestBytes ?? 10 * 1024 * 1024;
  const upstreamFetch = options.upstreamFetch ?? fetch;
  const server = http.createServer(async (req, res) => {
    try {
      const route = safePath(req.url ?? ''); if (!route) return reply(res, 400, 'invalid_request', 'Invalid proxy path.');
      const provider = PROVIDERS[route.alias]; if (!provider) return reply(res, 404, 'unknown_alias', 'Unknown provider alias.');
      const auth = req.headers.authorization;
      const tokenMatch = typeof auth === 'string' ? /^Bearer (klp_v1_[A-Za-z0-9_-]+)$/.exec(auth) : null;
      if (!tokenMatch) return reply(res, 401, 'token_invalid', 'A valid Keyless project token is required.');
      const upstreamPath = route.upstreamPath.split('?')[0];
      let validated: any;
      try { validated = await ipcRequest(resolveIpcAddress(options.socketPath), 'validate_token', { token: tokenMatch[1], alias: route.alias, host: provider.host, method: req.method, path: upstreamPath }); }
      catch { return reply(res, 401, 'token_invalid', 'The project token is invalid or the requested access is not granted.'); }
      let credential: any;
      try { credential = await ipcRequest(resolveIpcAddress(options.socketPath), 'resolve_credential', { projectId: validated.projectId, alias: route.alias }); }
      catch { return reply(res, 403, 'credential_unavailable', 'The granted credential is unavailable.'); }
      const body = await readBody(req, maxBytes);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        const lower = name.toLowerCase();
        if (['authorization', 'x-api-key', 'host', 'cookie', 'proxy-authorization', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'forwarded', 'via'].includes(lower) || lower.startsWith('x-forwarded-')) continue;
        if (Array.isArray(value)) headers.set(name, value.join(', ')); else headers.set(name, value);
      }
      headers.set(provider.authHeader, `${provider.prefix}${credential.secret}`);
      const url = `https://${provider.host}${route.upstreamPath}`;
      const upstream = await upstreamFetch(url, { method: req.method, headers, body: body.length ? body : undefined, redirect: 'manual' });
      res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([name]) => !['set-cookie', 'www-authenticate', 'connection', 'transfer-encoding'].includes(name.toLowerCase()))));
      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();
      try { while (true) { const { done, value } = await reader.read(); if (done) break; if (!res.write(Buffer.from(value))) await new Promise<void>((resolve) => res.once('drain', resolve)); } res.end(); }
      finally { reader.releaseLock(); }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof Error && error.message === 'body_too_large') return reply(res, 413, 'body_too_large', 'Request body exceeds the configured limit.');
      reply(res, 502, 'upstream_error', 'The upstream request could not be completed.');
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('proxy failed to bind TCP port');
  return { address: host, port: address.port, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

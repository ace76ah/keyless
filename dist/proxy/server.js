import http from 'node:http';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { resolveIpcAddress } from '../daemon/ipc.js';
const PROVIDERS = {
    openai: { host: 'api.openai.com', authHeader: 'authorization', prefix: 'Bearer ' },
    anthropic: { host: 'api.anthropic.com', authHeader: 'x-api-key', prefix: '' },
};
async function ipcRequest(address, command, args) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(address);
        let buffer = '';
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon IPC timeout')); }, 5000);
        socket.once('connect', () => socket.write(`${JSON.stringify({ command, args })}\n`));
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const newline = buffer.indexOf('\n');
            if (newline < 0)
                return;
            clearTimeout(timer);
            socket.end();
            try {
                const response = JSON.parse(buffer.slice(0, newline));
                if (!response.ok)
                    reject(new Error(response.error || 'daemon request failed'));
                else
                    resolve(response.data);
            }
            catch (error) {
                reject(error);
            }
        });
        socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
}
function reply(res, status, code, message) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: code, code, message }));
}
function normalizeUpstreamPath(raw) {
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    }
    catch {
        return null;
    }
    if (decoded.includes("\0"))
        return null;
    if (/%2f|%5c/i.test(raw))
        return null;
    try {
        const twice = decodeURIComponent(decoded);
        if (twice !== decoded)
            return null;
    }
    catch {
        return null;
    }
    const segments = decoded.split("/");
    if (segments.some((seg) => seg === "." || seg === ".."))
        return null;
    const collapsed = decoded.replace(/\/+/g, "/");
    const withLeading = collapsed.startsWith("/") ? collapsed : "/" + collapsed;
    return withLeading.length > 1 ? withLeading.replace(/\/$/, "") : withLeading;
}
function safePath(raw) {
    if (!raw.startsWith("/"))
        return null;
    if (raw.includes("\\"))
        return null;
    const match = /^\/c\/([a-z][a-z0-9-]{0,31})(\/.*)?$/.exec(raw);
    if (!match)
        return null;
    const alias = match[1];
    const rawUpstream = match[2] || "/";
    const normalized = normalizeUpstreamPath(rawUpstream);
    if (normalized === null)
        return null;
    return { alias, upstreamPath: normalized };
}
async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.length;
        if (size > limit)
            throw new Error('body_too_large');
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}
export async function createProxyServer(options) {
    const host = options.host ?? '127.0.0.1';
    const maxBytes = options.maxRequestBytes ?? 10 * 1024 * 1024;
    const upstreamFetch = options.upstreamFetch ?? fetch;
    const server = http.createServer(async (req, res) => {
        const started = performance.now();
        const route = safePath(req.url ?? '');
        const provider = route ? PROVIDERS[route.alias] : undefined;
        let projectId = 'unknown';
        let auditAttempted = false;
        const audit = async (status) => {
            if (auditAttempted || !route || !req.method)
                return;
            auditAttempted = true;
            await ipcRequest(resolveIpcAddress(options.socketPath), 'audit_proxy_request', {
                projectId, alias: route.alias, method: req.method,
                host: provider?.host ?? 'unknown',
                path: route.upstreamPath.split('?')[0],
                status, durationMs: performance.now() - started,
            });
        };
        const fail = async (status, code, message) => {
            try {
                await audit(status);
            }
            catch (err) {
                return reply(res, 503, 'audit_unavailable', 'Request blocked because audit logging is unavailable.');
            }
            reply(res, status, code, message);
        };
        try {
            if (!route)
                return reply(res, 400, 'invalid_request', 'Invalid proxy path.');
            if (!provider)
                return fail(404, 'unknown_alias', 'Unknown provider alias.');
            const auth = req.headers.authorization;
            const token = typeof auth === 'string' ? /^Bearer (klp_v1_[A-Za-z0-9_-]+)$/.exec(auth)?.[1] : undefined;
            if (!token)
                return fail(401, 'token_invalid', 'A valid Keyless project token is required.');
            let validated;
            try {
                validated = await ipcRequest(resolveIpcAddress(options.socketPath), 'validate_token', {
                    token, alias: route.alias, host: provider.host, method: req.method,
                    path: route.upstreamPath.split('?')[0],
                });
                projectId = validated.projectId;
            }
            catch {
                return fail(401, 'token_invalid', 'The project token is invalid or access is not granted.');
            }
            let credential;
            try {
                credential = await ipcRequest(resolveIpcAddress(options.socketPath), 'resolve_credential', { projectId, alias: route.alias });
            }
            catch {
                return fail(403, 'credential_unavailable', 'The granted credential is unavailable.');
            }
            const body = await readBody(req, maxBytes);
            const headers = new Headers();
            for (const [name, value] of Object.entries(req.headers)) {
                if (value === undefined)
                    continue;
                const lower = name.toLowerCase();
                if (['authorization', 'x-api-key', 'host', 'cookie', 'proxy-authorization', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'forwarded', 'via'].includes(lower) || lower.startsWith('x-forwarded-'))
                    continue;
                headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            headers.set(provider.authHeader, `${provider.prefix}${credential.secret}`);
            const upstream = await upstreamFetch(`https://${provider.host}${route.upstreamPath}`, {
                method: req.method ?? "GET", headers, body: body.length ? new Uint8Array(body) : undefined, redirect: 'manual',
            });
            try {
                await audit(upstream.status);
            }
            catch {
                await upstream.body?.cancel().catch(() => undefined);
                return reply(res, 503, 'audit_unavailable', 'Upstream response withheld because audit logging failed.');
            }
            res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([name]) => !['set-cookie', 'www-authenticate', 'connection', 'transfer-encoding'].includes(name.toLowerCase()))));
            if (!upstream.body)
                return res.end();
            const reader = upstream.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (!res.write(Buffer.from(value)))
                        await new Promise((resolve) => res.once('drain', resolve));
                }
                res.end();
            }
            finally {
                reader.releaseLock();
            }
        }
        catch (error) {
            const status = error instanceof Error && error.message === 'body_too_large' ? 413 : 502;
            if (!auditAttempted && route) {
                try {
                    await audit(status);
                }
                catch {
                    if (!res.headersSent)
                        return reply(res, 503, 'audit_unavailable', 'Audit logging is unavailable.');
                }
            }
            if (res.headersSent)
                return res.destroy();
            if (status === 413)
                reply(res, 413, 'body_too_large', 'Request body exceeds the configured limit.');
            else
                reply(res, 502, 'upstream_error', 'The upstream request could not be completed.');
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, host, () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('proxy failed to bind TCP port');
    return {
        address: host, port: address.port,
        close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
const ZERO_HASH = '0'.repeat(64);
const MAX_LINE_BYTES = 16 * 1024;
function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function canonical(value) {
    // The event object is built with a fixed field order below; nested caller data is never accepted.
    return JSON.stringify(value);
}
function validateInput(input) {
    if (!input || typeof input !== 'object')
        throw new Error('invalid audit event');
    for (const [key, value, max] of [
        ['projectId', input.projectId, 64],
        ['alias', input.alias, 32],
        ['method', input.method, 16],
        ['host', input.host, 253],
        ['path', input.path, 2048],
    ]) {
        if (typeof value !== 'string' || value.length < 1 || value.length > max ||
            /[\r\n\0]/.test(value))
            throw new Error(`invalid audit field: ${key}`);
    }
    if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599) {
        throw new Error('invalid audit status');
    }
    if (!Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 86_400_000) {
        throw new Error('invalid audit duration');
    }
}
function recordHash(sequence, previousHash, event) {
    return sha256(`${sequence}\n${previousHash}\n${canonical(event)}`);
}
async function ensurePrivateDirectory(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
        const { chmod } = await import('node:fs/promises');
        await chmod(dirname(path), 0o700);
    }
}
async function readHead(headPath) {
    try {
        const parsed = JSON.parse(await readFile(headPath, 'utf8'));
        if (!Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0 ||
            !/^[a-f0-9]{64}$/.test(parsed.hash))
            throw new Error('invalid audit checkpoint');
        return parsed;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { sequence: 0, hash: ZERO_HASH };
        throw error;
    }
}
async function writeHead(headPath, head) {
    const temp = `${headPath}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(head)}\n`, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await rename(temp, headPath);
        if (process.platform !== 'win32') {
            const dir = await open(dirname(headPath), 'r');
            try {
                await dir.sync();
            }
            finally {
                await dir.close();
            }
        }
    }
    catch (error) {
        const { unlink } = await import('node:fs/promises');
        await unlink(temp).catch(() => undefined);
        throw error;
    }
}
/**
 * Append-only NDJSON audit writer with a SHA-256 chain and a local head checkpoint.
 * The checkpoint detects accidental/truncated tail deletion; it is not an external
 * trust anchor against an attacker able to rewrite both files.
 */
export class AuditLog {
    path;
    headPath;
    queue = Promise.resolve();
    constructor(path) {
        this.path = path;
        this.headPath = `${path}.head`;
    }
    async appendProxyRequest(input) {
        const operation = this.queue.then(() => this.append(input));
        this.queue = operation.then(() => undefined, () => undefined);
        return operation;
    }
    async append(input) {
        validateInput(input);
        await ensurePrivateDirectory(this.path);
        const verified = await verifyAuditLog(this.path, this.headPath);
        const event = {
            schemaVersion: 1,
            eventId: randomUUID(),
            timestamp: new Date().toISOString(),
            event: 'proxy.request',
            projectId: input.projectId,
            alias: input.alias,
            method: input.method.toUpperCase(),
            host: input.host.toLowerCase(),
            path: input.path,
            status: input.status,
            durationMs: Math.round(input.durationMs * 100) / 100,
        };
        const sequence = verified.sequence + 1;
        const hash = recordHash(sequence, verified.hash, event);
        const record = { sequence, previousHash: verified.hash, event, hash };
        const line = `${JSON.stringify(record)}\n`;
        if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)
            throw new Error('audit event too large');
        const handle = await open(this.path, 'a', 0o600);
        try {
            await handle.writeFile(line, 'utf8');
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        if (process.platform !== 'win32') {
            const { chmod } = await import('node:fs/promises');
            await chmod(this.path, 0o600);
        }
        await writeHead(this.headPath, { sequence, hash });
        return event;
    }
}
export async function verifyAuditLog(path, headPath = `${path}.head`) {
    let content;
    try {
        content = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            const head = await readHead(headPath);
            if (head.sequence !== 0 || head.hash !== ZERO_HASH)
                throw new Error('audit log is missing or truncated');
            return head;
        }
        throw error;
    }
    const checkpoint = await readHead(headPath);
    const lines = content.split('\n');
    if (lines.at(-1) === '')
        lines.pop();
    let sequence = 0;
    let previousHash = ZERO_HASH;
    for (const line of lines) {
        if (!line || Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)
            throw new Error('invalid audit log line');
        let record;
        try {
            record = JSON.parse(line);
        }
        catch {
            throw new Error('invalid audit log JSON');
        }
        if (record.sequence !== sequence + 1 || record.previousHash !== previousHash ||
            !record.event || record.event.schemaVersion !== 1 ||
            record.hash !== recordHash(record.sequence, record.previousHash, record.event)) {
            throw new Error(`audit integrity verification failed at sequence ${sequence + 1}`);
        }
        sequence = record.sequence;
        previousHash = record.hash;
    }
    if (checkpoint.sequence !== sequence || checkpoint.hash !== previousHash) {
        throw new Error('audit log does not match its integrity checkpoint (truncated or modified)');
    }
    return { sequence, hash: previousHash };
}
export async function readAuditEvents(path) {
    await verifyAuditLog(path);
    let content;
    try {
        content = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line).event);
}

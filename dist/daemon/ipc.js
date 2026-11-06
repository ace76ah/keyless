import net from 'node:net';
import { createHash } from 'node:crypto';
import { chmod, unlink } from 'node:fs/promises';
/**
 * Resolve a stable IPC endpoint. Unix uses the caller-provided socket path;
 * Windows uses a deterministic named-pipe name derived from that path.
 */
export function resolveIpcAddress(socketPath, platform = process.platform) {
    if (platform !== 'win32')
        return socketPath;
    const suffix = createHash('sha256').update(socketPath).digest('hex').slice(0, 24);
    return `\\\\.\\pipe\\keyless-${suffix}`;
}
function isRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    return typeof record.command === 'string' &&
        (record.args === undefined ||
            (typeof record.args === 'object' && record.args !== null && !Array.isArray(record.args)));
}
function writeJsonLine(socket, value) {
    return new Promise((resolve, reject) => {
        socket.write(`${JSON.stringify(value)}\n`, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
export async function createIpcServer(options) {
    const maxLineBytes = options.maxLineBytes ?? 64 * 1024;
    const address = resolveIpcAddress(options.socketPath);
    const sockets = new Set();
    let closing = null;
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.setNoDelay(true);
        let buffered = Buffer.alloc(0);
        let queue = Promise.resolve();
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => sockets.delete(socket));
        socket.on('data', (chunk) => {
            buffered = Buffer.concat([buffered, chunk]);
            if (buffered.length > maxLineBytes && !buffered.includes(0x0a)) {
                void writeJsonLine(socket, { ok: false, error: 'request line too large' })
                    .catch(() => undefined)
                    .finally(() => socket.destroy());
                buffered = Buffer.alloc(0);
                return;
            }
            let newline;
            while ((newline = buffered.indexOf(0x0a)) !== -1) {
                const line = buffered.subarray(0, newline);
                buffered = buffered.subarray(newline + 1);
                if (line.length > maxLineBytes) {
                    void writeJsonLine(socket, { ok: false, error: 'request line too large' })
                        .catch(() => undefined)
                        .finally(() => socket.destroy());
                    return;
                }
                const requestLine = Buffer.from(line);
                queue = queue.then(async () => {
                    if (socket.destroyed)
                        return;
                    let parsed;
                    try {
                        parsed = JSON.parse(requestLine.toString('utf8'));
                    }
                    catch {
                        await writeJsonLine(socket, { ok: false, error: 'invalid JSON request' });
                        return;
                    }
                    if (!isRequest(parsed)) {
                        await writeJsonLine(socket, { ok: false, error: 'invalid request' });
                        return;
                    }
                    try {
                        const result = await options.handler(parsed);
                        const response = { ok: true, data: result.data };
                        if (result.closeAfterReply) {
                            // Flush the response, then close this connection and the listener.
                            socket.end(`${JSON.stringify(response)}\n`, () => {
                                socket.destroy();
                                void close();
                            });
                        }
                        else {
                            await writeJsonLine(socket, response);
                        }
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : 'request failed';
                        await writeJsonLine(socket, { ok: false, error: message });
                    }
                }).catch(() => { socket.destroy(); });
            }
            if (buffered.length > maxLineBytes) {
                void writeJsonLine(socket, { ok: false, error: 'request line too large' })
                    .catch(() => undefined)
                    .finally(() => socket.destroy());
            }
        });
    });
    await new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(address);
    });
    if (process.platform !== 'win32') {
        try {
            await chmod(address, 0o600);
        }
        catch (error) {
            await new Promise((resolve) => server.close(() => resolve()));
            await unlink(address).catch(() => undefined);
            throw error;
        }
    }
    async function close() {
        if (closing)
            return closing;
        closing = new Promise((resolve, reject) => {
            for (const socket of sockets)
                socket.destroy();
            server.close((error) => {
                void (async () => {
                    if (process.platform !== 'win32') {
                        try {
                            await unlink(address);
                        }
                        catch (unlinkError) {
                            if (unlinkError.code !== 'ENOENT')
                                throw unlinkError;
                        }
                    }
                    if (error)
                        throw error;
                })().then(resolve, reject);
            });
        });
        return closing;
    }
    return { address, close };
}

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import net from 'node:net';
import { Vault } from '../vault/vault.js';
import { resolveIpcAddress } from '../daemon/ipc.js';
import { runGrantCommand } from './commands/grant.js';
import { runLogCommand } from './commands/log.js';
const HOME = homedir();
const DEFAULT_DIR = join(HOME, '.keyless');
const DEFAULT_VAULT = join(DEFAULT_DIR, 'vault.json');
const DEFAULT_SOCKET = join(DEFAULT_DIR, 'daemon.sock');
const DEFAULT_AUDIT = join(DEFAULT_DIR, 'audit.log');
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
function option(args, name, fallback) {
    const index = args.indexOf(name);
    if (index < 0) {
        if (fallback !== undefined)
            return fallback;
        throw new Error(`missing ${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--'))
        throw new Error(`${name} requires a value`);
    return value;
}
function has(args, name) { return args.includes(name); }
function list(value) { return value.split(',').map((part) => part.trim()).filter(Boolean); }
async function promptSecret(label) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
        throw new Error(`${label} must be supplied through an interactive terminal or environment variable`);
    }
    process.stderr.write(`${label}: `);
    return new Promise((resolveSecret, reject) => {
        let value = '';
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        const onData = (chunk) => {
            for (const byte of chunk) {
                if (byte === 3) {
                    cleanup();
                    reject(new Error('cancelled'));
                    return;
                }
                if (byte === 13 || byte === 10) {
                    process.stderr.write('\n');
                    cleanup();
                    resolveSecret(value);
                    return;
                }
                if (byte === 127 || byte === 8)
                    value = value.slice(0, -1);
                else if (byte >= 32)
                    value += String.fromCharCode(byte);
            }
        };
        const cleanup = () => {
            stdin.off('data', onData);
            stdin.setRawMode(Boolean(wasRaw));
            stdin.pause();
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}
async function getPassphrase() {
    return process.env.KEYLESS_PASSPHRASE ?? promptSecret('Vault passphrase');
}
async function ipcRequest(socketPath, command, args = {}) {
    return new Promise((resolveResult, reject) => {
        const socket = net.createConnection(resolveIpcAddress(socketPath));
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
                    resolveResult(response.data);
            }
            catch (error) {
                reject(error);
            }
        });
        socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
}
async function waitForDaemon(socketPath, child) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (child.exitCode !== null)
            throw new Error('daemon exited during startup');
        try {
            await ipcRequest(socketPath, 'status');
            return;
        }
        catch {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    child.kill('SIGTERM');
    throw new Error('daemon did not become ready');
}
export async function main(argv = process.argv.slice(2)) {
    if (argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write(`Keyless - secure credential gateway

Usage:
  keyless init
  keyless add <alias> --provider openai|anthropic
  keyless grant <alias> [options]
  keyless daemon start|status
  keyless proxy start
  keyless lock
  keyless log

Options:
  -h, --help    Show this help menu
`);
        process.exit(0);
    }
    const [command, ...tail] = argv;
    const action = (command === 'daemon' || command === 'proxy' || command === 'add' || command === 'grant') ? tail[0] : undefined;
    const args = action === undefined ? tail : tail.slice(1);
    if (command === 'init') {
        const vaultPath = option(args, '--vault', DEFAULT_VAULT);
        const passphrase = await getPassphrase();
        const { mkdir } = await import('node:fs/promises');
        await mkdir(resolve(vaultPath, '..'), { recursive: true, mode: 0o700 });
        const vault = await Vault.create(vaultPath, passphrase);
        await vault.close();
        process.stdout.write(`Vault initialized: ${vaultPath}\n`);
        return;
    }
    if (command === 'add') {
        const alias = action;
        if (!alias)
            throw new Error('usage: keyless add <alias> --provider openai|anthropic');
        const provider = option(args, '--provider', alias);
        if (!['openai', 'anthropic'].includes(provider))
            throw new Error('provider must be openai or anthropic');
        const secret = process.env.KEYLESS_SECRET ?? await promptSecret(`${provider} API credential`);
        const passphrase = await getPassphrase();
        const vaultPath = option(args, '--vault', DEFAULT_VAULT);
        const vault = await Vault.open(vaultPath, passphrase);
        try {
            await vault.add(alias, provider, secret);
        }
        finally {
            await vault.close();
        }
        process.stdout.write(`Credential added: ${alias}\n`);
        return;
    }
    if (command === 'grant') {
        const alias = action;
        if (!alias)
            throw new Error('usage: keyless grant <alias> --provider openai|anthropic --methods GET,POST --paths /v1/models');
        const provider = option(args, '--provider', 'openai');
        const input = {
            alias, provider,
            host: option(args, '--host', provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com'),
            methods: list(option(args, '--methods', 'POST')),
            paths: list(option(args, '--paths', '/v1/chat/completions')),
            expiresInDays: Number(option(args, '--expires-days', '1')),
        };
        const result = await runGrantCommand(input, {
            socketPath: option(args, '--socket', DEFAULT_SOCKET),
            confirm: async (question) => {
                if (process.env.KEYLESS_AUTO_CONFIRM === 'yes' || has(args, '--yes'))
                    return true;
                if (!process.stdin.isTTY)
                    throw new Error('grant approval requires a TTY or KEYLESS_AUTO_CONFIRM=yes');
                const rl = createInterface({ input: process.stdin, output: process.stderr });
                try {
                    const answer = await new Promise((resolve) => {
                        rl.question(`${question} Type "yes": `, (ans) => resolve(ans));
                    });
                    return answer.trim() === "yes";
                }
                catch (err) {
                    return false;
                }
                finally {
                    rl.close();
                }
            },
        });
        if (result)
            process.stdout.write(`PROJECT_TOKEN=${result.token}\nPROJECT_ID=${result.projectId}\n`);
        return;
    }
    if (command === 'daemon' && action === 'start') {
        const socketPath = option(args, '--socket', DEFAULT_SOCKET);
        const vaultPath = option(args, '--vault', DEFAULT_VAULT);
        const auditPath = option(args, '--audit', DEFAULT_AUDIT);
        const passphrase = await getPassphrase();
        const child = spawn(process.execPath, [join(REPO_ROOT, 'dist/daemon/server.js'), '--vault', vaultPath, '--socket', socketPath, '--audit', auditPath], {
            detached: true, stdio: ['pipe', 'ignore', 'inherit'],
        });
        child.stdin?.end(`${passphrase}\n`);
        await waitForDaemon(socketPath, child);
        await (await import('node:fs/promises')).writeFile(join(DEFAULT_DIR, 'daemon.pid'), `${child.pid}\n`, { mode: 0o600 });
        child.unref();
        process.stdout.write(`Daemon started (pid ${child.pid}).\n`);
        return;
    }
    if (command === 'daemon' && action === 'status') {
        process.stdout.write(`${JSON.stringify(await ipcRequest(option(args, '--socket', DEFAULT_SOCKET), 'status'), null, 2)}\n`);
        return;
    }
    if (command === 'proxy' && action === 'start') {
        // Refuse to spawn a duplicate proxy if the port is already bound.
        {
            const probe = await import('node:net');
            const inUse = await new Promise((resolve) => {
                const srv = probe.createServer();
                srv.once('error', (err) => {
                    resolve(err && err.code === 'EADDRINUSE');
                });
                srv.once('listening', () => srv.close(() => resolve(false)));
                srv.listen(Number(option(args, '--port', '8787')), '127.0.0.1');
            });
            if (inUse) {
                process.stdout.write(`Proxy already running on 127.0.0.1:${option(args, '--port', '8787')}\n`);
                return;
            }
        }
        const socketPath = option(args, '--socket', DEFAULT_SOCKET);
        const port = Number(option(args, '--port', '8787'));
        const mock = has(args, '--mock-upstream');
        const moduleUrl = new URL('../proxy/server.js', import.meta.url).href;
        const source = `
      import { createProxyServer } from ${JSON.stringify(moduleUrl)};
      const mock = ${mock};
      const handle = await createProxyServer({
        socketPath: ${JSON.stringify(socketPath)}, host: '127.0.0.1', port: ${port},
        upstreamFetch: mock ? async (_url, init) => new Response(JSON.stringify({
          ok: true, credentialInjected: Boolean(new Headers(init.headers).get('authorization') || new Headers(init.headers).get('x-api-key'))
        }), { status: 200, headers: { 'content-type': 'application/json' } }) : fetch
      });
      process.stdout.write(JSON.stringify({ready:true,port:handle.port}) + '\\\\n');
      const stop = async () => { await handle.close(); process.exit(0); };
      process.on('SIGTERM', stop); process.on('SIGINT', stop);
    `;
        const child = spawn(process.execPath, ['--input-type=module', '-e', source], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
        await new Promise((done, reject) => { child.once('spawn', () => done()); child.once('error', reject); });
        await (await import('node:fs/promises')).writeFile(join(DEFAULT_DIR, 'proxy.pid'), `${child.pid}\n`, { mode: 0o600 });
        child.unref();
        process.stdout.write(`Proxy starting on 127.0.0.1:${port}${mock ? ' (mock upstream)' : ''}.\n`);
        return;
    }
    if (command === 'revoke') {
        const projectId = tail[0];
        if (!projectId)
            throw new Error('usage: keyless revoke <projectId>');
        await ipcRequest(option(args, '--socket', DEFAULT_SOCKET), 'revoke', { projectId });
        process.stdout.write(`Project token revoked: ${projectId}\n`);
        return;
    }
    if (command === 'lock') {
        // Stop the proxy first, then lock the vault.
        try {
            const fsmod = await import('node:fs/promises');
            const pidRaw = await fsmod.readFile(join(DEFAULT_DIR, 'proxy.pid'), 'utf8');
            const pid = Number(pidRaw.trim());
            if (pid > 0) {
                try {
                    process.kill(pid, 'SIGTERM');
                }
                catch { /* already dead */ }
            }
            await fsmod.unlink(join(DEFAULT_DIR, 'proxy.pid')).catch(() => { });
        }
        catch { /* no proxy was running */ }
        await ipcRequest(option(args, '--socket', DEFAULT_SOCKET), 'lock');
        process.stdout.write('Vault locked.\n');
        return;
    }
    if (command === 'log') {
        await runLogCommand(option(args, '--file', DEFAULT_AUDIT));
        return;
    }
    throw new Error('usage: keyless init | add <alias> | grant <alias> | daemon start|status | proxy start | lock | log');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    void main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'keyless failed'}\n`);
        process.exitCode = 1;
    });
}

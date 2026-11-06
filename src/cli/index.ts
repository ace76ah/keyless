import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { resolveIpcAddress } from '../daemon/ipc.ts';
import { runGrantCommand, type GrantInput } from './commands/grant.ts';
import { runLogCommand } from './commands/log.ts';

async function askPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return await new Promise((done) => rl.question('Vault passphrase: ', done)); }
  finally { rl.close(); }
}
async function request(socketPath: string, command: string): Promise<unknown> {
  return new Promise((resolveResponse, reject) => {
    const socket = net.createConnection(resolveIpcAddress(socketPath));
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon IPC timeout')); }, 5000);
    socket.once('connect', () => socket.write(`${JSON.stringify({ command, args: {} })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      clearTimeout(timer); socket.end();
      try {
        const value = JSON.parse(buffer.slice(0, index));
        if (value.ok) resolveResponse(value.data);
        else reject(new Error(value.error));
      } catch (error) { reject(error); }
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
function option(args: string[], name: string, fallback?: string): string {
  const index = args.indexOf(name);
  if (index < 0) { if (fallback !== undefined) return fallback; throw new Error(`missing ${name}`); }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}
function list(args: string[], name: string): string[] {
  return option(args, name).split(',').map((item) => item.trim()).filter(Boolean);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [rootCommand, action, ...rest] = argv;
  const defaultSocket = join(homedir(), '.keyless', 'daemon.sock');

  if (rootCommand === 'daemon' && action === 'start') {
    const socket = option(rest, '--socket', defaultSocket);
    const vault = option(rest, '--vault', join(homedir(), '.keyless', 'vault.json'));
    const passphrase = await askPassphrase();
    const child = spawn(process.execPath, [
      '--experimental-strip-types', resolve('src/daemon/server.ts'),
      '--vault', vault, '--socket', socket,
    ], { detached: true, stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin?.end(`${passphrase}\n`);
    child.unref();
    process.stdout.write('Keyless daemon starting. Check with `keyless daemon status`.\\n');
    return;
  }
  if (rootCommand === 'daemon' && action === 'status') {
    process.stdout.write(`${JSON.stringify(await request(option(rest, '--socket', defaultSocket), 'status'), null, 2)}\n`);
    return;
  }
  if (rootCommand === 'lock') {
    await request(option(rest, '--socket', defaultSocket), 'lock');
    process.stdout.write('Vault locked.\n');
    return;
  }
  if (rootCommand === 'grant') {
    const provider = option(rest, '--provider') as GrantInput['provider'];
    const input: GrantInput = {
      alias: option(rest, '--alias'),
      provider,
      host: option(rest, '--host', provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com'),
      methods: list(rest, '--methods'),
      paths: list(rest, '--paths'),
      expiresInDays: Number(option(rest, '--expires-days', '30')),
    };
    await runGrantCommand(input, { socketPath: option(rest, '--socket', defaultSocket) });
    return;
  }
  if (rootCommand === 'log') {
    await runLogCommand(option(rest, '--file', join(homedir(), '.keyless', 'audit.log')));
    return;
  }
  throw new Error('usage: keyless daemon start|status | keyless lock | keyless grant --alias NAME --provider openai|anthropic --methods GET,POST --paths /v1/models,/v1/responses | keyless log');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'command failed'}\n`);
    process.exitCode = 1;
  });
}

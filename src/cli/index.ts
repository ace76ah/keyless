import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { resolveIpcAddress } from '../daemon/ipc.ts';

async function askPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return await new Promise((done) => rl.question('Vault passphrase: ', done)); }
  finally { rl.close(); }
}
async function request(socketPath: string, command: string): Promise<unknown> {
  return new Promise((resolveResponse, reject) => {
    const socket = net.createConnection(resolveIpcAddress(socketPath)); let buffer = '';
    socket.once('connect', () => socket.write(`${JSON.stringify({ command, args: {} })}\n`));
    socket.on('data', (chunk) => { buffer += chunk.toString(); const i = buffer.indexOf('\n'); if (i < 0) return; socket.end(); try { const value = JSON.parse(buffer.slice(0, i)); value.ok ? resolveResponse(value.data) : reject(new Error(value.error)); } catch (error) { reject(error); } });
    socket.once('error', reject);
  });
}
function option(args: string[], name: string, fallback?: string): string {
  const index = args.indexOf(name); if (index < 0) { if (fallback) return fallback; throw new Error(`missing ${name}`); }
  const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`); return value;
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [root, action, ...rest] = argv;
  const socket = option(rest, '--socket', `${process.env.HOME}/.keyless/daemon.sock`);
  if (root === 'daemon' && action === 'start') {
    const vault = option(rest, '--vault', `${process.env.HOME}/.keyless/vault.json`);
    const passphrase = await askPassphrase();
    const child = spawn(process.execPath, ['--experimental-strip-types', resolve('src/daemon/server.ts'), '--vault', vault, '--socket', socket], { detached: true, stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin?.end(`${passphrase}\n`); child.unref(); process.stdout.write('Keyless daemon starting. Check with `keyless daemon status`.\n'); return;
  }
  if (root === 'daemon' && action === 'status') { process.stdout.write(`${JSON.stringify(await request(socket, 'status'), null, 2)}\n`); return; }
  if (root === 'lock') { await request(socket, 'lock'); process.stdout.write('Vault locked.\n'); return; }
  throw new Error('usage: keyless daemon start|status [--vault path] [--socket path] | keyless lock');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'command failed'}\n`); process.exitCode = 1; });

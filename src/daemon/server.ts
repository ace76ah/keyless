import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Vault } from '../vault/vault.ts';
import { createIpcServer, type IpcServerHandle } from './ipc.ts';

export type DaemonOptions = { vaultPath: string; socketPath: string; passphrase: string; onReady?: (address: string) => void };
export type DaemonHandle = { address: string; close(): Promise<void> };

export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const vault = await Vault.open(options.vaultPath, options.passphrase);
  let ipc: IpcServerHandle;
  try {
    ipc = await createIpcServer({ socketPath: options.socketPath, handler: async ({ command, args = {} }) => {
      switch (command) {
        case 'status': return { data: { locked: false, vaultPath: options.vaultPath } };
        case 'add': {
          const { name, provider, secret } = args;
          if (typeof name !== 'string' || typeof provider !== 'string' || typeof secret !== 'string') throw new Error('add requires string name, provider, and secret');
          await vault.add(name, provider, secret); return { data: { added: name } };
        }
        case 'validate_token': {
          const { token, alias, host, method, path } = args;
          if (typeof token !== 'string') throw new Error('validate_token requires token');
          const result = await vault.validateToken(token, {
            ...(typeof alias === 'string' ? { alias } : {}), ...(typeof host === 'string' ? { host } : {}),
            ...(typeof method === 'string' ? { method } : {}), ...(typeof path === 'string' ? { path } : {}),
          });
          return { data: result };
        }
        case 'resolve_credential': {
          const { projectId, alias } = args;
          if (typeof projectId !== 'string' || typeof alias !== 'string') throw new Error('resolve_credential requires projectId and alias');
          return { data: await vault.resolveCredential(projectId, alias) };
        }
        case 'lock': await vault.close(); return { data: { locked: true }, closeAfterReply: true };
        default: throw new Error(`unknown command: ${command}`);
      }
    } });
  } catch (error) { await vault.close(); throw error; }
  options.onReady?.(ipc.address);
  return { address: ipc.address, async close() { await vault.close(); await ipc.close(); } };
}

function parseArgs(argv: string[]): { vaultPath: string; socketPath: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (key === '--vault' || key === '--socket') { const value = argv[i + 1]; if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`); values.set(key, value); i++; }
    else throw new Error(`unknown argument: ${key}`);
  }
  const vaultPath = values.get('--vault'); const socketPath = values.get('--socket');
  if (!vaultPath || !socketPath) throw new Error('usage: server.ts --vault <path> --socket <path> (passphrase is read from stdin)');
  return { vaultPath, socketPath };
}
async function readPassphraseFromStdin(): Promise<string> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try { for await (const line of input) return line; throw new Error('passphrase was not provided on stdin'); }
  finally { input.close(); }
}
async function main(): Promise<void> {
  const { vaultPath, socketPath } = parseArgs(process.argv.slice(2)); const passphrase = await readPassphraseFromStdin();
  await startDaemon({ vaultPath, socketPath, passphrase, onReady(address) { process.stdout.write(`${JSON.stringify({ ready: true, address })}\n`); } });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main().catch((error) => { process.stderr.write(`${JSON.stringify({ ready: false, error: error instanceof Error ? error.message : 'daemon startup failed' })}\n`); process.exitCode = 1; });

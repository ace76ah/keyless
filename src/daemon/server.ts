import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Vault } from '../vault/vault.ts';
import { createIpcServer, type IpcServerHandle } from './ipc.ts';
import { AuditLog, type ProxyAuditInput } from './audit.ts';

export type DaemonOptions = {
  vaultPath: string;
  socketPath: string;
  passphrase: string;
  auditPath?: string;
  onReady?: (address: string) => void;
};
export type DaemonHandle = { address: string; close(): Promise<void> };

export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const vault = await Vault.open(options.vaultPath, options.passphrase);
  const audit = new AuditLog(options.auditPath ?? join(homedir(), '.keyless', 'audit.log'));
  let ipc: IpcServerHandle;
  try {
    ipc = await createIpcServer({
      socketPath: options.socketPath,
      handler: async ({ command, args = {} }) => {
        switch (command) {
          case 'status':
            return { data: { locked: false, vaultPath: options.vaultPath } };
          case 'add':
            if (typeof args.name !== 'string' || typeof args.provider !== 'string' || typeof args.secret !== 'string') throw new Error('add requires string name, provider, and secret');
            await vault.add(args.name, args.provider, args.secret);
            return { data: { added: args.name } };
          case 'add_token':
            if (typeof args.projectId !== 'string' || typeof args.token !== 'string' || typeof args.expiresAt !== 'string' || !Array.isArray(args.grants)) throw new Error('add_token requires projectId, token, expiresAt and grants');
            await vault.addToken(args.projectId, args.token, args.expiresAt, args.grants as Parameters<typeof vault.addToken>[3]);
            return { data: { projectId: args.projectId, added: true } };
          case 'validate_token': {
            if (typeof args.token !== 'string') throw new Error('validate_token requires token');
            const result = await vault.validateToken(args.token, {
              ...(typeof args.alias === 'string' ? { alias: args.alias } : {}),
              ...(typeof args.host === 'string' ? { host: args.host } : {}),
              ...(typeof args.method === 'string' ? { method: args.method } : {}),
              ...(typeof args.path === 'string' ? { path: args.path } : {}),
            });
            return { data: result };
          }
          case 'resolve_credential':
            if (typeof args.projectId !== 'string' || typeof args.alias !== 'string') throw new Error('resolve_credential requires projectId and alias');
            return { data: await vault.resolveCredential(args.projectId, args.alias) };
          case 'audit_proxy_request': {
            const event = args as unknown as ProxyAuditInput;
            await audit.appendProxyRequest(event);
            return { data: { recorded: true } };
          }
          case 'lock':
            await vault.close();
            return { data: { locked: true }, closeAfterReply: true };
          default:
            throw new Error(`unknown command: ${command}`);
        }
      },
    });
  } catch (error) {
    await vault.close();
    throw error;
  }
  options.onReady?.(ipc.address);
  return {
    address: ipc.address,
    async close() { await vault.close(); await ipc.close(); },
  };
}

function parseArgs(argv: string[]): { vaultPath: string; socketPath: string; auditPath?: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--vault' || key === '--socket' || key === '--audit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
      values.set(key, value); i += 1;
    } else throw new Error(`unknown argument: ${key}`);
  }
  const vaultPath = values.get('--vault'); const socketPath = values.get('--socket');
  if (!vaultPath || !socketPath) throw new Error('usage: server.ts --vault <path> --socket <path> [--audit path]');
  return { vaultPath, socketPath, ...(values.has('--audit') ? { auditPath: values.get('--audit')! } : {}) };
}

async function readPassphraseFromStdin(): Promise<string> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try { for await (const line of input) return line; throw new Error('passphrase was not provided on stdin'); }
  finally { input.close(); }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const passphrase = await readPassphraseFromStdin();
  await startDaemon({ ...args, passphrase, onReady(address) { process.stdout.write(`${JSON.stringify({ ready: true, address })}\n`); } });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ready: false, error: error instanceof Error ? error.message : 'daemon startup failed' })}\n`);
    process.exitCode = 1;
  });
}

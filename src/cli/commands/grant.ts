import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { resolveIpcAddress } from '../../daemon/ipc.ts';

export type GrantInput = {
  alias: string;
  provider: 'openai' | 'anthropic';
  host: string;
  methods: string[];
  paths: string[];
  expiresInDays?: number;
};

function ipc(socketPath: string, command: string, args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(resolveIpcAddress(socketPath));
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon IPC timeout')); }, 5000);
    socket.once('connect', () => socket.write(`${JSON.stringify({ command, args })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.ok) reject(new Error(response.error || 'daemon request failed'));
        else resolve(response.data);
      } catch (error) { reject(error); }
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} Type "yes" to approve: `, (answer) => {
      rl.close();
      resolve(answer.trim() === 'yes');
    });
  });
}

export function canonicalGrantDiff(input: GrantInput): { diff: Record<string, unknown>; hash: string } {
  const diff = {
    alias: input.alias,
    provider: input.provider,
    host: input.host,
    methods: [...new Set(input.methods.map((method) => method.toUpperCase()))].sort(),
    paths: [...new Set(input.paths)].sort(),
  };
  const hash = createHash('sha256').update(JSON.stringify(diff), 'utf8').digest('hex');
  return { diff, hash };
}

export async function runGrantCommand(
  input: GrantInput,
  options: { socketPath?: string; confirm?: (question: string) => Promise<boolean> } = {},
): Promise<{ projectId: string; token: string } | null> {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.alias)) throw new Error('invalid alias');
  const expectedHost = input.provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com';
  if (input.host !== expectedHost) throw new Error('provider and host do not match');
  if (!input.methods.length || input.methods.some((method) => !['GET', 'POST'].includes(method.toUpperCase()))) throw new Error('methods must be GET and/or POST');
  if (!input.paths.length || input.paths.some((path) => !path.startsWith('/') || path.includes('..') || /[%\\\0]/.test(path))) throw new Error('invalid API path');
  const { diff, hash } = canonicalGrantDiff(input);
  process.stdout.write('Permission diff:\n');
  process.stdout.write(`  Alias:   ${diff.alias}\n  Host:    ${diff.host}\n  Methods: ${(diff.methods as string[]).join(', ')}\n  Paths:\n${(diff.paths as string[]).map((path) => `    ${path}`).join('\n')}\n`);
  process.stdout.write(`  SHA-256: ${hash}\n`);
  const confirm = options.confirm ?? promptYesNo;
  if (!await confirm('Approve these exact permissions?')) {
    process.stdout.write('Grant cancelled.\n');
    return null;
  }

  const socketPath = options.socketPath ?? join(homedir(), '.keyless', 'daemon.sock');
  const projectId = randomUUID();
  const token = `klp_v1_${randomBytes(32).toString('base64url')}`;
  const expiresInDays = input.expiresInDays ?? 30;
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) throw new Error('expiry must be 1–365 days');
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  const grants = [{
    alias: input.alias,
    provider: input.provider,
    host: input.host,
    enabled: true,
    methods: diff.methods,
    paths: diff.paths,
    queryParameters: [],
    models: [],
    limits: {
      requestsPerMinute: 60,
      requestsPerDay: 2000,
      maxConcurrent: 3,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 10_485_760,
    },
    revision: 1,
    approval: {
      approvedAt: new Date().toISOString(),
      approvalHash: hash,
      requestDigest: hash,
      grantRevision: 1,
      mechanism: 'caller-tty-code',
    },
  }];
  await ipc(socketPath, 'add_token', { projectId, token, expiresAt, grants });
  process.stdout.write(`Project ID: ${projectId}\nProject token (shown once): ${token}\n`);
  return { projectId, token };
}

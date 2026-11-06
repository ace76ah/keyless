import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { Vault } from '../src/vault/vault.ts';
import { resolveIpcAddress } from '../src/daemon/ipc.ts';

function connect(address) {
  return new Promise((resolveConnect, reject) => {
    const socket = net.createConnection(address);
    socket.once('connect', () => resolveConnect(socket));
    socket.once('error', reject);
  });
}

function readLine(socket) {
  return new Promise((resolveLine, reject) => {
    let buffered = '';
    const onData = (chunk) => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline !== -1) {
        cleanup();
        resolveLine(JSON.parse(buffered.slice(0, newline)));
      }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('socket closed before response')); };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function send(socket, request) {
  socket.write(`${JSON.stringify(request)}\n`);
  return readLine(socket);
}

test('daemon serves status and lock over private IPC, then exits', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'keyless-daemon-'));
  const vaultPath = join(directory, 'vault.json');
  const requestedSocketPath = join(directory, 'keyless.sock');
  const address = resolveIpcAddress(requestedSocketPath);
  const passphrase = 'daemon-test-passphrase';

  const vault = await Vault.create(vaultPath, passphrase);
  await vault.close();

  const serverPath = resolve('src/daemon/server.ts');
  const child = spawn(process.execPath, [
    '--experimental-strip-types',
    serverPath,
    '--vault', vaultPath,
    '--socket', requestedSocketPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  t.after(async () => {
    if (child.exitCode === null && !child.killed) {
      try { child.kill('SIGTERM'); } catch { /* already exited */ }
    }
    await rm(directory, { recursive: true, force: true });
  });

  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrChunks = [];
  child.stdin.end(`${passphrase}\n`);
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));
  const ready = await Promise.race([
    (async () => {
      for await (const line of stdout) {
        const value = JSON.parse(line);
        if (value.ready) return value;
        if (value.error) throw new Error(value.error);
      }
      throw new Error('daemon exited before becoming ready');
    })(),
    once(child, 'exit').then(([code]) => {
      throw new Error(`daemon exited before ready (${code}): ${stderrChunks.join('')}`);
    }),
  ]);

  assert.equal(ready.address, address);

  if (process.platform !== 'win32') {
    const mode = (await stat(address)).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  const socket = await connect(address);
  const status = await send(socket, { command: 'status', args: {} });
  assert.equal(status.ok, true);
  assert.deepEqual(status.data, { locked: false, vaultPath });

  const addResponse = await send(socket, {
    command: 'add',
    args: { name: 'openai', provider: 'openai', secret: 'sk-daemon-test' },
  });
  assert.equal(addResponse.ok, true);
  assert.deepEqual(addResponse.data, { added: 'openai' });

  const lockResponse = await send(socket, { command: 'lock', args: {} });
  assert.equal(lockResponse.ok, true);
  assert.deepEqual(lockResponse.data, { locked: true });

  await Promise.race([
    once(socket, 'close'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('IPC socket did not close')), 3000)),
  ]);
  socket.destroy();

  const [exitCode] = await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('daemon did not exit after lock')), 3000)),
  ]);
  assert.equal(exitCode, 0);

  const reopened = await Vault.open(vaultPath, passphrase);
  assert.deepEqual(await reopened.list(), ['openai']);
  await reopened.close();
});

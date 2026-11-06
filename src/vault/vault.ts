import { randomBytes } from 'node:crypto';
import { type VaultFs, realFs } from './fs.ts';
import { deriveKey, encrypt, decrypt } from './crypto.ts';
import { buildAad, serializeVault, parseVault, parseGeneration } from './format.ts';
import {
  VaultConflictError, VaultLockedError, VaultIoError, VaultError,
  WrongPassphraseError, VaultFormatError,
} from './errors.ts';

const DEFAULT_KDF = Object.freeze({ m: 65536, t: 3, p: 4 });
const MAX_GENERATION = 0xffff_ffff_ffff_ffffn;

export class Vault {
  private _path: string;
  private _fs: VaultFs;
  private _key: Buffer | null = null;
  private _credentials: Record<string, { provider: string; secret: string }> | null = null;
  private _generation = 0n;
  private _vaultId: Buffer | null = null;
  private _kdfParams: { algorithm: 'argon2id'; m: number; t: number; p: number } | null = null;
  private _salt: Buffer | null = null;
  private _closed = false;

  private constructor(path: string, fs: VaultFs) { this._path = path; this._fs = fs; }

  static async create(path: string, passphrase: string): Promise<Vault> {
    const vault = new Vault(path, realFs);
    await vault._withLock(async () => {
      // A lock serializes creators; this existence check prevents accidental overwrite.
      try {
        await realFs.readFile(path);
        throw new VaultIoError('vault already exists');
      } catch (error) {
        if (error instanceof VaultIoError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const salt = randomBytes(16);
      const vaultId = randomBytes(16);
      const key = await deriveKey(Buffer.from(passphrase, 'utf8'), salt, DEFAULT_KDF);
      vault._key = key;
      vault._salt = salt;
      vault._vaultId = vaultId;
      vault._generation = 0n;
      vault._credentials = {};
      vault._kdfParams = { algorithm: 'argon2id', ...DEFAULT_KDF };
      try { await vault._writeSnapshot({}, 0n); }
      catch (error) { key.fill(0); vault._key = null; throw error; }
    });
    return vault;
  }

  static async open(path: string, passphrase: string, fs: VaultFs = realFs): Promise<Vault> {
    const vault = new Vault(path, fs);
    let key: Buffer | null = null;
    try {
      const data = parseVault(await fs.readFile(path));
      const salt = Buffer.from(data.kdf.salt, 'base64');
      key = await deriveKey(Buffer.from(passphrase, 'utf8'), salt, data.kdf);
      const vaultId = Buffer.from(data.vaultId, 'base64');
      const generation = parseGeneration(data.generation);
      const aad = buildAad({
        version: data.version, vaultId, generation,
        kdf: { ...data.kdf, salt },
      });
      const plaintext = decrypt(
        key,
        Buffer.from(data.payload.nonce, 'base64'),
        Buffer.from(data.payload.ciphertext, 'base64'),
        Buffer.from(data.payload.tag, 'base64'),
        aad,
      );
      let payload: unknown;
      try { payload = JSON.parse(plaintext.toString('utf8')); }
      catch { throw new WrongPassphraseError('vault cannot be opened'); }
      finally { plaintext.fill(0); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new WrongPassphraseError('vault cannot be opened');
      }
      const value = payload as Record<string, unknown>;
      if (value.vaultId !== data.vaultId || !value.credentials || typeof value.credentials !== 'object' || Array.isArray(value.credentials)) {
        throw new WrongPassphraseError('vault cannot be opened');
      }
      vault._key = key;
      vault._salt = salt;
      vault._vaultId = vaultId;
      vault._generation = generation;
      vault._credentials = value.credentials as Record<string, { provider: string; secret: string }>;
      vault._kdfParams = { algorithm: 'argon2id', m: data.kdf.m, t: data.kdf.t, p: data.kdf.p };
      key = null;
      return vault;
    } catch (error) {
      key?.fill(0);
      if (error instanceof WrongPassphraseError || error instanceof VaultFormatError || error instanceof VaultIoError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof Error && error.message.includes('read')) {
        throw new VaultIoError('cannot read vault file');
      }
      throw error;
    }
  }

  get generation(): bigint { this._assertOpen(); return this._generation; }

  async list(): Promise<string[]> { this._assertOpen(); return Object.keys(this._credentials!); }

  async add(name: string, provider: string, secret: string): Promise<void> {
    this._assertOpen();
    if (!name || !provider || typeof secret !== 'string') throw new VaultError('invalid credential');
    if (Object.hasOwn(this._credentials!, name)) throw new VaultError('credential already exists');
    const nextGeneration = this._nextGeneration();
    const nextCredentials = { ...this._credentials!, [name]: { provider, secret } };
    await this._writeTransaction(nextCredentials, nextGeneration);
    this._credentials = nextCredentials;
    this._generation = nextGeneration;
  }

  async remove(name: string): Promise<void> {
    this._assertOpen();
    if (!Object.hasOwn(this._credentials!, name)) return;
    const nextGeneration = this._nextGeneration();
    const nextCredentials = { ...this._credentials! };
    delete nextCredentials[name];
    await this._writeTransaction(nextCredentials, nextGeneration);
    this._credentials = nextCredentials;
    this._generation = nextGeneration;
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._key?.fill(0);
    this._salt?.fill(0);
    this._vaultId?.fill(0);
    this._key = null;
    this._credentials = null;
    this._vaultId = null;
    this._salt = null;
    this._kdfParams = null;
  }

  private _nextGeneration(): bigint {
    if (this._generation === MAX_GENERATION) throw new VaultError('generation overflow');
    return this._generation + 1n;
  }

  private _assertOpen(): void { if (this._closed) throw new VaultLockedError('vault is closed'); }

  private async _acquireLock(): Promise<void> {
    const lockPath = `${this._path}.lock`;
    const lockData = JSON.stringify({ pid: process.pid, timestamp: Date.now() });

    try {
      await this._fs.writeFileExclusive(lockPath, lockData);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    // A live POSIX process is authoritative: age alone must never break its lock.
    // On Windows, where reliable cross-process PID probing is not portable here,
    // use the documented 10-second age threshold.
    let stale = false;
    try {
      const raw = (await this._fs.readFile(lockPath)).toString('utf8');
      const current: unknown = JSON.parse(raw);
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        throw new Error('invalid lock record');
      }
      const record = current as { pid?: unknown; timestamp?: unknown };
      if (!Number.isSafeInteger(record.pid) || (record.pid as number) <= 0 ||
          !Number.isFinite(record.timestamp) || (record.timestamp as number) <= 0) {
        throw new Error('invalid lock record');
      }
      const isOld = Date.now() - (record.timestamp as number) > 10_000;

      if (process.platform === 'win32') {
        stale = isOld;
      } else {
        try {
          process.kill(record.pid as number, 0);
          stale = false;
        } catch (probeError) {
          const code = (probeError as NodeJS.ErrnoException).code;
          if (code === 'ESRCH') stale = true;
          else if (code === 'EPERM') stale = false;
          else throw probeError;
        }
      }
    } catch {
      // Unreadable or malformed lock records are hard conflicts, not permission
      // to remove a lock whose owner cannot be established.
      stale = false;
    }

    if (stale) {
      await this._fs.unlink(lockPath);
      // Exactly one exclusive retry. If another writer won the race, surface
      // the conflict rather than attempting repeated lock stealing.
      try {
        await this._fs.writeFileExclusive(lockPath, lockData);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new VaultConflictError('vault lock was reclaimed by another writer');
        }
        throw error;
      }
    }

    throw new VaultConflictError(`vault is locked by another process (delete ${lockPath} only if you have confirmed its owner crashed)`);
  }

  private async _withLock<T>(fn: () => Promise<T>): Promise<T> {
    this._assertOpen();
    const lockPath = `${this._path}.lock`;
    await this._acquireLock();
    try { return await fn(); }
    finally { await this._fs.unlink(lockPath).catch(() => undefined); }
  }

  private async _writeTransaction(credentials: Record<string, { provider: string; secret: string }>, generation: bigint): Promise<void> {
    await this._withLock(async () => {
      let current;
      try { current = parseVault(await this._fs.readFile(this._path)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultConflictError('vault file no longer exists');
        throw error;
      }
      if (parseGeneration(current.generation) !== this._generation) throw new VaultConflictError('generation mismatch');
      await this._writeSnapshot(credentials, generation);
    });
  }

  private async _writeSnapshot(credentials: Record<string, { provider: string; secret: string }>, generation: bigint): Promise<void> {
    const aad = buildAad({ version: 1, vaultId: this._vaultId!, generation, kdf: { ...this._kdfParams!, salt: this._salt! } });
    const plaintext = Buffer.from(JSON.stringify({ vaultId: this._vaultId!.toString('base64'), credentials }), 'utf8');
    let payload;
    try { payload = encrypt(this._key!, plaintext, aad); }
    finally { plaintext.fill(0); }
    const content = serializeVault({
      magic: 'KEYLESS', version: 1, vaultId: this._vaultId!.toString('base64'), generation: generation.toString(),
      kdf: { ...this._kdfParams!, salt: this._salt!.toString('base64') },
      payload: { nonce: payload.nonce.toString('base64'), ciphertext: payload.ciphertext.toString('base64'), tag: payload.tag.toString('base64') },
    });
    const tmpPath = `${this._path}.${randomBytes(16).toString('hex')}.tmp`;
    try {
      await this._fs.writeFileTmp(tmpPath, content, 0o600);
      await this._fs.fsyncAndRename(tmpPath, this._path);
    } catch (error) {
      await this._fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }
}

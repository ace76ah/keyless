import { Buffer } from 'node:buffer';
import { KdfParamsError, VaultFormatError, VaultVersionError } from './errors.js';

export const VAULT_MAGIC = 'KEYLESS' as const;
export const VAULT_VERSION = 1 as const;
export const VAULT_ID_BYTES = 16;
export const VAULT_SALT_BYTES = 16;
export const VAULT_NONCE_BYTES = 24;
export const VAULT_TAG_BYTES = 16;
export const VAULT_KEY_BYTES = 32;
export const MAX_VAULT_BYTES = 64 * 1024 * 1024;

// Resource bounds are checked before invoking Argon2id. Defaults are current,
// not frozen; benchmark results will determine the v1 defaults separately.
export const KDF_LIMITS = Object.freeze({
  minMemoryKiB: 65536,
  maxMemoryKiB: 1024 * 1024,
  minIterations: 3,
  maxIterations: 10,
  minParallelism: 1,
  maxParallelism: 4,
});

export interface KdfParameters {
  algorithm: 'argon2id';
  m: number;
  t: number;
  p: number;
  salt: Buffer;
}

export interface VaultEnvelope {
  magic: typeof VAULT_MAGIC;
  version: number;
  vaultId: string;
  generation: string;
  kdf: {
    algorithm: 'argon2id';
    m: number;
    t: number;
    p: number;
    salt: string;
  };
  payload: {
    nonce: string;
    ciphertext: string;
    tag: string;
  };
}

export function validateKdfParameters(kdf: Pick<KdfParameters, 'algorithm' | 'm' | 't' | 'p' | 'salt'>): void {
  if (kdf.algorithm !== 'argon2id') throw new VaultFormatError('Unsupported KDF algorithm.');
  if (!Number.isSafeInteger(kdf.m) || kdf.m < KDF_LIMITS.minMemoryKiB) {
    throw new KdfParamsError(`m below floor (${KDF_LIMITS.minMemoryKiB} KiB).`);
  }
  if (kdf.m > KDF_LIMITS.maxMemoryKiB) {
    throw new KdfParamsError(`m above ceiling (${KDF_LIMITS.maxMemoryKiB} KiB).`);
  }
  if (!Number.isSafeInteger(kdf.t) || kdf.t < KDF_LIMITS.minIterations || kdf.t > KDF_LIMITS.maxIterations) {
    throw new KdfParamsError('t outside permitted range.');
  }
  if (!Number.isSafeInteger(kdf.p) || kdf.p < KDF_LIMITS.minParallelism || kdf.p > KDF_LIMITS.maxParallelism) {
    throw new KdfParamsError('p outside permitted range.');
  }
  if (kdf.m < 8 * kdf.p) throw new KdfParamsError('m must be at least 8 times p.');
  if (!Buffer.isBuffer(kdf.salt) || kdf.salt.length !== VAULT_SALT_BYTES) {
    throw new VaultFormatError(`salt must be exactly ${VAULT_SALT_BYTES} bytes.`);
  }
}

function assertBytes(name: string, value: Buffer, length: number): void {
  if (!Buffer.isBuffer(value) || value.length !== length) {
    throw new VaultFormatError(`${name} must be exactly ${length} bytes.`);
  }
}

function u32be(value: number, name: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new VaultFormatError(`${name} must be an unsigned 32-bit integer.`);
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}

export function parseGeneration(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new VaultFormatError('generation must be a canonical unsigned decimal string.');
  }
  const generation = BigInt(value);
  if (generation > 0xffff_ffff_ffff_ffffn) throw new VaultFormatError('generation exceeds the unsigned 64-bit range.');
  return generation;
}

/** Build the exact v1 AEAD associated-data byte sequence. */
export function buildAad(input: {
  version: number;
  vaultId: Buffer;
  generation: bigint;
  kdf: KdfParameters;
}): Buffer {
  assertBytes('vaultId', input.vaultId, VAULT_ID_BYTES);
  if (input.version !== VAULT_VERSION) throw new VaultFormatError('Unsupported vault version for AAD.');
  if (typeof input.generation !== 'bigint' || input.generation < 0n || input.generation > 0xffff_ffff_ffff_ffffn) {
    throw new VaultFormatError('generation must be an unsigned 64-bit bigint.');
  }
  validateKdfParameters(input.kdf);

  const generation = Buffer.alloc(8);
  generation.writeBigUInt64BE(input.generation);
  return Buffer.concat([
    Buffer.from('KEYLESS\0', 'ascii'),
    u32be(input.version, 'version'),
    input.vaultId,
    generation,
    Buffer.from('argon2id', 'ascii'),
    u32be(input.kdf.m, 'm'),
    u32be(input.kdf.t, 't'),
    u32be(input.kdf.p, 'p'),
    input.kdf.salt,
  ]);
}

function decodeBase64(name: string, value: unknown, expectedLength?: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new VaultFormatError(`${name} must be valid standard base64.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new VaultFormatError(`${name} has non-canonical base64 encoding.`);
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new VaultFormatError(`${name} must decode to exactly ${expectedLength} bytes.`);
  }
  return decoded;
}

export function serializeVault(envelope: VaultEnvelope): Buffer {
  // Serialization is deliberately deterministic in field order for readable
  // files. Cryptographic authentication uses buildAad(), never JSON text.
  const json = JSON.stringify(envelope, null, 2) + '\n';
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.length > MAX_VAULT_BYTES) throw new VaultFormatError('Vault exceeds the maximum supported size.');
  return bytes;
}

export function parseVault(input: Buffer | string): VaultEnvelope {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (bytes.length === 0 || bytes.length > MAX_VAULT_BYTES) throw new VaultFormatError('Vault file is empty or exceeds the maximum supported size.');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new VaultFormatError('Vault file is not valid JSON.'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new VaultFormatError('Vault envelope must be a JSON object.');
  const v = value as Record<string, unknown>;
  if (v.magic !== VAULT_MAGIC) throw new VaultFormatError('Unrecognized vault file.');
  if (!Number.isSafeInteger(v.version) || (v.version as number) < 1) throw new VaultFormatError('Invalid vault version.');
  if (v.version !== VAULT_VERSION) throw new VaultVersionError(v.version as number);

  const vaultId = decodeBase64('vaultId', v.vaultId, VAULT_ID_BYTES);
  parseGeneration(v.generation);
  if (!v.kdf || typeof v.kdf !== 'object' || Array.isArray(v.kdf)) throw new VaultFormatError('Invalid KDF metadata.');
  const k = v.kdf as Record<string, unknown>;
  const salt = decodeBase64('kdf.salt', k.salt, VAULT_SALT_BYTES);
  const kdf = { algorithm: k.algorithm, m: k.m, t: k.t, p: k.p, salt } as KdfParameters;
  validateKdfParameters(kdf);
  if (!v.payload || typeof v.payload !== 'object' || Array.isArray(v.payload)) throw new VaultFormatError('Invalid encrypted payload.');
  const p = v.payload as Record<string, unknown>;
  decodeBase64('payload.nonce', p.nonce, VAULT_NONCE_BYTES);
  decodeBase64('payload.ciphertext', p.ciphertext);
  decodeBase64('payload.tag', p.tag, VAULT_TAG_BYTES);

  return {
    magic: VAULT_MAGIC,
    version: VAULT_VERSION,
    vaultId: (v.vaultId as string),
    generation: v.generation as string,
    kdf: { algorithm: 'argon2id', m: kdf.m, t: kdf.t, p: kdf.p, salt: k.salt as string },
    payload: { nonce: p.nonce as string, ciphertext: p.ciphertext as string, tag: p.tag as string },
  };
}

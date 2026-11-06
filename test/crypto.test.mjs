import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deriveKey, encrypt, decrypt } from '../dist/vault/crypto.js';
import { argon2id } from '@noble/hashes/argon2';
import { randomBytes } from 'node:crypto';
import { WrongPassphraseError } from '../dist/vault/errors.js';

test('deriveKey is deterministic and returns 32 bytes', async () => {
  const salt = randomBytes(16);
  const params = { m: 65536, t: 3, p: 4 };
  const key1 = await deriveKey(Buffer.from('pass'), salt, params);
  const key2 = await deriveKey(Buffer.from('pass'), salt, params);
  assert.deepEqual(key1, key2);
  assert.equal(key1.length, 32);
  key1.fill(0); key2.fill(0);
});

test('deriveKey matches argon2id directly', async () => {
  const salt = randomBytes(16);
  const params = { m: 65536, t: 3, p: 4 };
  const key = await deriveKey(Buffer.from('pass'), salt, params);
  const direct = argon2id(Buffer.from('pass'), salt, { ...params, dkLen: 32 });
  assert.deepEqual(key, Buffer.from(direct));
  key.fill(0); direct.fill(0);
});

test('encrypt uses a fresh nonce', () => {
  const key = randomBytes(32);
  const aad = Buffer.from('aad');
  const first = encrypt(key, Buffer.from('hello'), aad);
  const second = encrypt(key, Buffer.from('hello'), aad);
  assert.notDeepEqual(first.nonce, second.nonce);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
  key.fill(0);
});

test('decrypt throws WrongPassphraseError on tag mismatch', () => {
  const key = randomBytes(32);
  const aad = Buffer.from('aad');
  const sealed = encrypt(key, Buffer.from('hello'), aad);
  const badTag = Buffer.from(sealed.tag);
  badTag[0] ^= 0xff;
  assert.throws(() => decrypt(key, sealed.nonce, sealed.ciphertext, badTag, aad), WrongPassphraseError);
  key.fill(0);
});

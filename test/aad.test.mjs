import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildAad } from '../dist/vault/format.js';

// Frozen known-answer vector for format version 1. Any change requires a
// format-version review and a matching documentation update.
const FIXTURE = {
  version: 1,
  vaultId: Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
  generation: 0n,
  kdf: {
    algorithm: 'argon2id',
    m: 65536,
    t: 3,
    p: 1,
    salt: Buffer.from('fedcba9876543210fedcba9876543210', 'hex'),
  },
};

const EXPECTED_HEX =
  '4b45594c45535300' +
  '00000001' +
  '0123456789abcdef0123456789abcdef' +
  '0000000000000000' +
  '6172676f6e326964' +
  '00010000' +
  '00000003' +
  '00000001' +
  'fedcba9876543210fedcba9876543210';

test('AAD v1 matches the frozen canonical byte vector', () => {
  assert.equal(buildAad(FIXTURE).toString('hex'), EXPECTED_HEX);
});

# Keyless vault file format — version 1

Status: implementation draft. The envelope and AAD byte layout are specified here; KDF defaults are current working defaults and are **not frozen** pending measurements on the target MacBook Air.

## JSON envelope

The vault is a UTF-8 JSON document with this shape:

```json
{
  "magic": "KEYLESS",
  "version": 1,
  "vaultId": "<base64: 16 random bytes>",
  "generation": "0",
  "kdf": {
    "algorithm": "argon2id",
    "m": 65536,
    "t": 3,
    "p": 4,
    "salt": "<base64: 16 random bytes>"
  },
  "payload": {
    "nonce": "<base64: 24 random bytes>",
    "ciphertext": "<base64>",
    "tag": "<base64: 16 bytes>"
  }
}
```

`vaultId` is generated once from 16 random bytes, remains stable across re-encryption and passphrase changes, is not secret, and is never used for key derivation. The decrypted payload contains its own `vaultId`; after successful AEAD authentication, the implementation must compare the two IDs and report a mismatch as the same authentication failure used for a wrong passphrase or damaged ciphertext.

`generation` is an unsigned 64-bit integer represented as a canonical decimal string in JSON. It starts at `0`. It is encoded as eight-byte big-endian in AAD. It must never wrap; a mutation at `2^64 - 1` fails with `VaultGenerationOverflowError`.

The KDF metadata and `vaultId` are plaintext but authenticated. Credential names, count, provider identifiers, and secrets are inside the encrypted payload. Base64 values use canonical standard Base64 encoding.

## Cryptographic parameters

- KDF: Argon2id, version 19, 32-byte output.
- Current working defaults: `m = 65536` KiB, `t = 3`, `p = 4`.
- Salt: 16 random bytes.
- AEAD: XChaCha20-Poly1305.
- Nonce: 24 random bytes.
- Authentication tag: 16 bytes.
- Maximum serialized vault size: 64 MiB.

The KDF defaults are not frozen until the target-machine benchmark is recorded. Resource bounds must be validated before calling the KDF; parameters are rejected, never silently clamped. The current implementation bounds memory to 64 MiB–1 GiB, iterations to 3–10, and parallelism to 1–4 lanes, with `m >= 8p`. These bounds are implementation limits, not a benchmark-based freeze of the working defaults.

## AAD v1 byte layout

All integers are unsigned big-endian. The byte sequence is concatenated exactly as follows; no JSON serialization is involved.

| Offset | Length | Field | Encoding |
|---:|---:|---|---|
| 0 | 8 | Domain separator | ASCII `KEYLESS\0` |
| 8 | 4 | Format version | `u32`, value 1 |
| 12 | 16 | Vault ID | Raw 16 bytes |
| 28 | 8 | Generation | `u64` big-endian |
| 36 | 8 | KDF algorithm | ASCII `argon2id` |
| 44 | 4 | Memory cost | `u32` KiB |
| 48 | 4 | Iterations | `u32` |
| 52 | 4 | Parallelism | `u32` |
| 56 | 16 | KDF salt | Raw 16 bytes |

The nonce, ciphertext, and tag are AEAD inputs, not AAD fields. Any change to this layout requires a format-version decision and corresponding test/documentation update.

### AAD v1 canonical known-answer vector

Fixture values:

- version: `1`
- vault ID: `0123456789abcdef0123456789abcdef`
- generation: `0`
- KDF: Argon2id, `m=65536`, `t=3`, `p=1` (the known-answer vector intentionally exercises a valid non-default lane count)
- salt: `fedcba9876543210fedcba9876543210`

Expected complete AAD bytes, hexadecimal:

```text
4b45594c45535300
00000001
0123456789abcdef0123456789abcdef
0000000000000000
6172676f6e326964
00010000
00000003
00000001
fedcba9876543210fedcba9876543210
```

The test fixture is independently hardcoded in `test/aad.test.mjs`; do not generate the expected value from `buildAad()`.

## Authentication and version handling

- Unsupported future format versions fail with `VaultVersionError` before v1-specific envelope interpretation or KDF work.
- Wrong passphrase, AEAD failure, and post-decryption `vaultId` mismatch use one indistinguishable authentication error class.
- Structural errors detected before decryption may use `VaultFormatError`.
- KDF parameters are bounded before KDF invocation.

## Memory handling limitations

`close()` zeroes retained key buffers and best-effort overwrites plaintext buffers before dropping references to the credential map. This is best-effort, not a guarantee: JavaScript has no `mlock`, and the runtime and KDF/AEAD libraries may briefly hold copies in memory that the caller cannot overwrite. Keyless does not claim perfect zeroization. Deployments requiring stronger guarantees should disable swap and core dumps at the operating-system level where feasible; these controls are outside the JavaScript implementation.

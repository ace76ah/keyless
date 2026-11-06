# Security policy

Keyless is an early local-first credential gateway. It is intended to reduce accidental exposure of provider credentials and restrict normal agent requests to grants stored in an encrypted local vault. It is not a sandbox and is not a substitute for operating-system isolation.

## Supported cryptography

The current vault implementation uses:

- **Authenticated encryption:** XChaCha20-Poly1305.
- **Password-based key derivation:** Argon2id, version 19, 32-byte output.
- **Current Argon2id defaults:** `m = 65536` KiB, `t = 3`, `p = 4`.
- **Salt:** 16 random bytes.
- **Nonce:** 24 random bytes.
- **Authentication tag:** 16 bytes.
- **Key derivation after Argon2id:** HKDF-SHA-256 as specified by the v1 vault format.
- **Project token storage:** SHA-256 digest of the presented token; plaintext project token is returned to the CLI once at grant creation.

The Argon2id values above are the current implementation defaults. They remain subject to target-machine benchmarking and should not be described as permanently frozen until that benchmark is recorded. KDF parameters are bounded and validated before derivation.

The vault uses authenticated metadata (including vault ID, generation and KDF parameters) as associated data. Wrong passphrase and authenticated-data/ciphertext failures are intentionally reported through a common authentication failure.

## Implemented security controls

- Vault data is encrypted at rest.
- The daemon owns the unlocked vault and exposes a local IPC interface.
- The proxy binds to loopback and uses daemon IPC to validate project tokens and resolve granted credentials.
- The proxy removes caller-supplied authentication headers before injecting the vault-held provider credential.
- Project grants constrain provider alias, host, methods and paths.
- Audit events are metadata-only and linked using a rolling SHA-256 chain plus a local checkpoint.
- POSIX vault, socket and audit files/directories use restrictive permissions where implemented.

These controls reduce accidental disclosure and constrain the normal request path. They do not create a separate OS security principal for an agent.

## Explicit limitations

1. **Same-user arbitrary code execution is out of scope.** Malicious code running as the same OS user may read project tokens, call the loopback proxy, inspect accessible files, or inspect daemon memory. Keyless does not protect against root/administrator access, kernel compromise or a compromised machine.
2. **No OS-level approval UI.** Grant approval currently relies on a terminal confirmation (`yes`). It is not macOS LocalAuthentication, Windows Hello or polkit, and must not be represented as strong proof of human presence.
3. **Approval replay hardening is incomplete.** The permission diff hash binds the displayed grant data, but there is no daemon-issued, expiring, one-time approval challenge.
4. **Windows support is untested.** Named-pipe and Windows ACL behavior have not been validated as a supported security boundary.
5. **Audit integrity is local.** The `.head` checkpoint detects changes to the log when the checkpoint remains intact. It does not prevent an attacker with write access to both files from rewriting the history. Automatic rotation is not implemented.
6. **JavaScript zeroization is best-effort.** Runtime/library copies and garbage-collected values cannot be reliably erased or protected from same-user memory inspection.
7. **External review remains outstanding.** Automated tests do not replace independent review of vault handling, IPC, authorization, proxy networking and grant approval.

## Reporting a vulnerability

If GitHub private vulnerability reporting is enabled, use it to report security issues privately. Please do not publish unpatched security details in public issues.

For general project support, contact [contact@aahmedhussa.in](mailto:contact@aahmedhussa.in). Do not send vulnerability details to the general support mailbox.

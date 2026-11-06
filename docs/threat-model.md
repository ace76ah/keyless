# Keyless threat model

**Status: Gate 1 implementation state. This document describes implemented components and known limitations; it is not an independent security certification.**

Keyless reduces accidental credential exposure and limits ordinary agent requests to permissions stored in a local encrypted vault. It does not sandbox an agent or isolate hostile code running as the same operating-system user.

## 1. Security objective

Provider credentials are stored in an encrypted local vault rather than ordinary project configuration, source files or agent context. During a normal proxied request, the local proxy authenticates a Keyless project token through the daemon, obtains the credential associated with an approved alias, removes caller-supplied authentication and injects the provider credential before forwarding.

The objective is **reduce accidental exposure and constrain normal credential use**, not prevent every possible use of credentials by software with the developer's OS privileges.

## 2. Assets

- Provider credentials in the encrypted vault and daemon memory.
- Vault passphrase-derived key material.
- Project tokens and their SHA-256 digests.
- Project IDs and vault-held grants.
- Audit events and the audit integrity checkpoint.
- Integrity and availability of the vault, daemon IPC endpoint and proxy.

## 3. Implemented components and trust boundaries

1. **Developer / human:** initializes and unlocks the vault, enters provider credentials and confirms grants in the terminal.
2. **CLI:** prompts for passphrases and secrets, manages vault operations, creates project grants through daemon IPC, starts/stops daemon and proxy processes, and verifies audit logs.
3. **Encrypted vault:** stores provider credentials, project token digests, project records and grants in the encrypted v1 JSON envelope.
4. **Daemon:** opens the vault, retains unlocked state, validates project tokens and grant constraints, resolves credentials, and appends audit events.
5. **Local HTTP proxy:** binds to `127.0.0.1`, accepts `/c/<alias>/...` requests, validates bearer project tokens through daemon IPC, resolves the approved credential, strips caller authentication headers and forwards to the provider origin configured for the alias.
6. **Audit log:** records request metadata in an append-only NDJSON file with a SHA-256 hash chain and a local `.head` checkpoint.
7. **Provider endpoint:** built-in provider mapping determines the upstream host; the incoming request does not select an arbitrary upstream hostname.

The project token is a local capability. It is not the provider API credential, and the proxy should never forward it upstream.

## 4. Implemented controls

- Vault encryption uses XChaCha20-Poly1305 with Argon2id-derived key material. Current defaults are `m=65536` KiB, `t=3`, `p=4`; see [vault-format.md](vault-format.md). These remain working defaults pending recorded benchmarking.
- Vault envelope metadata is authenticated as associated data; generation checks and write locking protect against stale concurrent writes.
- Project tokens are stored as SHA-256 digests and checked for validity/expiry/revocation by the vault.
- Grants are stored in the encrypted vault and checked for alias, host, method and path on the proxy request path.
- The proxy strips caller-provided authentication headers and inserts the provider credential resolved by the daemon.
- Audit events contain timestamp, project ID, alias, method, host, path, status and duration. Bodies, headers and secret values are not part of the audit event schema.
- The audit log verifies its SHA-256 chain and compares it with a checkpoint stored beside the log.
- The daemon IPC uses a local Unix-domain socket on POSIX and a named-pipe address on Windows. POSIX socket permissions are set to `0600`.

## 5. Out of scope

- **Arbitrary code execution as the same OS user.** A malicious same-user process may read project tokens, call the loopback proxy, inspect accessible files, or inspect daemon process memory. Grants reduce accidental cross-project access; they do not isolate a hostile process running with the same user privileges.
- Root/administrator access, kernel/firmware compromise or a compromised machine.
- Malicious dependencies intentionally executing with the user's privileges.
- Prompt injection or social engineering that persuades a human to approve an unsafe grant.
- Provider-side data handling, provider compromise or sensitive data intentionally included in an authorized request body.
- Preventing a user from deliberately copying a provider credential into an agent-controlled terminal, file or clipboard.
- Remote/hosted agents and container/network setups that cannot reach the host's loopback proxy.
- IDE-hosted inference traffic that does not expose a supported custom API endpoint. Keyless does not intercept system traffic or perform TLS interception.

## 6. Approval and grant limitations

Grant creation currently displays a normalized permission diff and requires the user to type `yes` in the terminal. A SHA-256 hash is recorded with the approval metadata to bind the record to the displayed diff.

This is not an OS-level authentication prompt. There is no macOS LocalAuthentication, Windows Hello or polkit integration, and no daemon-issued short-lived one-time challenge with challenge consumption. A process controlling the user's terminal may be able to influence or automate this interaction. Do not claim strong human-presence verification or replay-proof approval.

## 7. Audit limitations

The audit writer records metadata only: timestamp, project ID, alias, method, host, path, status and duration. It must not record request/response bodies, headers, provider credentials or project-token values.

The SHA-256 chain detects altered, reordered or deleted lines when the `.head` checkpoint remains intact. The checkpoint is stored beside the log, not in an external trust domain. An attacker able to rewrite both files can reconstruct a consistent chain. Automatic log rotation is not implemented.

## 8. Platform limitations

- macOS/Linux are the tested development targets.
- Windows named-pipe and ACL behavior is currently untested. Windows should not be described as a validated supported security platform.
- JavaScript key and plaintext buffer clearing is best-effort. Runtime copies, garbage collection and same-user memory inspection remain outside the guarantee.
- No OS-level approval UI is implemented.

## 9. Release considerations

The project owner reports that the Gate 1 end-to-end flow and 53-test suite passed locally. This is useful implementation evidence, not a substitute for independent security review.

Before production use, independently review:
- vault parsing, KDF bounds, crypto provider usage and key lifecycle;
- cross-process locking, atomic writes and crash recovery;
- IPC peer access and daemon lifecycle;
- token/grant validation and path normalization;
- proxy DNS/TLS/redirect/header behavior;
- audit event provenance, integrity checkpoint and failure handling;
- grant approval UX and replay resistance.

Do not claim that Keyless prevents same-user malicious code from using credentials. Its security promise is narrower: keep provider secrets out of ordinary agent configuration and constrain the normal request flow through a local vault-backed gateway.

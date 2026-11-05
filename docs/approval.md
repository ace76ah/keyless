# Human approval and reveal flow

**Status: Gate 0 design draft — must be reviewed with threat-model.md before implementation.**

## 1. Actions requiring approval

Interactive approval is required for:

- Creating or expanding a vault-held project grant.
- Adding a new provider alias to an existing project.
- Widening hosts, methods, paths, query parameters, models or transport limits.
- Rebinding a project identity after the canonical project path changes.
- Removing or rotating a credential when grants depend on it.
- Revealing a stored application secret with §keyless reveal§.

A project request file is never itself an approval. The daemon always compares the current request with the vault-held grant.

## 2. Platform approval

| Platform | Primary mechanism | Fallback |
|---|---|---|
| macOS | LocalAuthentication (Touch ID / OS authentication prompt) through a small platform adapter. | A typed, short-lived confirmation code displayed by the CLI and entered on the **calling process's** §/dev/tty§. |
| Windows | Windows Hello user verification through a platform adapter. | A typed, short-lived confirmation code on the caller's interactive console. |
| Linux | polkit authentication agent when available and configured for the Keyless action. | §pinentry-tty§ if available; otherwise a typed confirmation code on the caller's §/dev/tty§. |
| Headless / CI | Not supported for grant expansion or reveal in v1. | No fallback. The operation fails with an actionable error. |

The daemon must not rely on its own controlling TTY. It may run detached and have no terminal. The CLI owns the caller's TTY and passes the challenge response over authenticated local IPC.

A typed code is only a speed bump. It does not prove that a human is present if an agent controls the calling terminal. polkit, LocalAuthentication and Windows Hello provide OS-mediated confirmation, but they do not create a separate security principal from arbitrary malicious code running as the same user.

If a platform API is unavailable, do not silently downgrade to a background, auto-accepted or environment-variable approval.

## 3. Grant approval procedure

1. Read and validate §keyless.config.json§ as an untrusted request.
2. Load the current authoritative grant from the unlocked vault.
3. Normalize and sort all permission fields. Calculate the before/after diff.
4. Render the complete diff to the human: project identity, alias, provider host, methods, paths, query parameter names, model allowlist and each transport cap.
5. Calculate a request digest over the exact normalized request. Create a random one-time challenge nonce and a five-minute approval expiry.
6. Calculate an approval binding hash over:
   - protocol/approval schema version;
   - project ID;
   - current grant revision;
   - canonical current grant;
   - canonical requested grant;
   - request digest;
   - challenge nonce.
7. Ask the OS approval mechanism or caller-terminal fallback for confirmation.
8. Re-read the project request and recompute the request digest. If it changed, reject the approval, discard the challenge and show a fresh diff.
9. Re-check that the grant revision has not changed concurrently. If it has, abort and require a fresh preview.
10. Store the approved grant and approval hash in the encrypted vault, and append a metadata-only audit event containing the hash, project ID, alias, approver mechanism, timestamp and grant revision.
11. Invalidate the challenge. It cannot be replayed.

Approval is bound to the exact displayed grant diff, not merely to the alias name or a yes/no prompt.

## 4. Revocation

- Revocation is not an approval expansion and must be available immediately through §keyless revoke§ and §keyless token revoke§.
- The daemon checks token and grant revocation on each new request.
- Revoking an alias removes its authorization from the project grant without deleting the provider credential from the vault unless the user separately removes it.
- Revoking a project token invalidates that token immediately; the token file is deleted or renamed to a non-readable revoked marker after daemon confirmation.
- A daemon restart must reload revocation state from the vault before accepting requests.

## 5. Reveal flow

§keyless reveal <alias>§ is used only for application secrets stored by Keyless where the destination cannot use the proxy.

- Require an unlocked vault and a verified interactive caller TTY.
- Show the alias and destination context before approval. Do not display the secret in the approval diff.
- Reuse the platform approval mechanism above. Headless reveal is unsupported.
- After approval, write the value only to the calling terminal, with echo disabled where technically possible. Never print it into an agent transcript by default.
- Append a §REVEAL§ audit event with alias, project, timestamp and approval hash; never include the revealed value.
- Warn that a terminal controlled or recorded by an agent can capture the value. The user assumes that disclosure risk.
- If no interactive TTY is available, fail. Do not fall back to stdout redirection, environment variables or command-line arguments.

## 6. Failure cases

- OS approval denied or unavailable: make no grant change and issue no token.
- Caller TTY unavailable: fail with a clear message; no daemon-controlled TTY fallback.
- Request changes during approval: abort and re-render the exact diff.
- Grant changes concurrently: abort and require a fresh preview.
- Daemon crashes before durable commit: old grant remains authoritative; no token is considered active.
- Daemon crashes after durable commit but before response: command may be rerun; it must detect the committed grant and never create a wider duplicate grant.
- Audit append fails: fail closed for grant expansion and reveal. Revocation should still fail safe by persisting revocation before reporting success.


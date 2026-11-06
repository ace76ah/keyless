# Keyless Gate 1d overlay

Base repository: `ace76ah/keyless` main at `06de3197e97866ca3dacbd534b6c9eb8d6176755`.

## Included

- `src/daemon/audit.ts`: NDJSON append-only audit writer, SHA-256 chain, `.head` checkpoint.
- `src/daemon/audit-ipc.ts`: small IPC client helper for audit events.
- `src/daemon/server.ts`: `audit_proxy_request` and `add_token` IPC commands.
- `src/proxy/server.ts`: sends proxy outcomes to the daemon audit writer before returning provider responses.
- `src/cli/commands/grant.ts`: displays a deterministic permission diff, requires literal `yes`, then sends `add_token`.
- `src/cli/commands/log.ts`: verifies chain/checkpoint and prints a table.
- `src/cli/index.ts`: preserves daemon start/status and lock, and adds `grant` and `log`.
- `test/audit.test.mjs`: append, secret-exclusion, tamper and line-deletion tests.

## Apply

Overlay these files into the exact base checkout. Existing files not included remain unchanged.

## Commands

```bash
node --experimental-strip-types --test test/audit.test.mjs
npm test
```

## IPC additions

- `add_token`: `{ projectId, token, expiresAt, grants }`
- `audit_proxy_request`: `{ projectId, alias, method, host, path, status, durationMs }`

The proxy must call `audit_proxy_request` after each completed request if every proxy request is to be audited. The included proxy overlay calls `audit_proxy_request` for routed requests and withholds upstream responses if audit persistence fails.

## Important limitations / security notes

- The CLI's literal `yes` confirmation is a local TTY confirmation, not OS-level authentication. The grant records `caller-tty-code`; this is not equivalent to macOS LocalAuthentication, Windows Hello, or polkit.
- The approval hash binds the normalized displayed permission object, but this overlay does not implement an expiring daemon-issued approval challenge or one-time challenge consumption. Do not describe this as replay-proof interactive approval.
- The audit `.head` checkpoint detects tail truncation and line deletion when only the log is altered. It is stored beside the log and is not an external trust anchor; an attacker able to rewrite both files can rewrite the chain.
- The daemon accepts audit events over local IPC. For a complete security boundary, validate audit input server-side and connect the proxy to this IPC command. Do not trust arbitrary client-supplied project IDs without associating them with the successful token-validation result.
- No automatic log rotation is included in this stage.

# Keyless Gate 1c foundation + proxy (test overlay)

Based on `ace76ah/keyless` main commit `b7adb374d8babd2bd2803aab6763da34ff073257`.

## Included
- Vault-encrypted project token digests and per-project grants. Raw project tokens are never written to the vault.
- Daemon IPC commands `validate_token` and `resolve_credential`.
- Loopback HTTP proxy using the canonical `Authorization: Bearer klp_v1_...` project-token header.
- Provider destinations are fixed in code (`api.openai.com`, `api.anthropic.com`); caller Host and absolute URLs are not used.
- Caller Authorization and provider-key headers are stripped; provider credential is injected only after daemon validation.
- Mockable upstream `fetch` and integration test with a real daemon/vault.
- Minimal CLI scaffold: `daemon start`, `daemon status`, `lock`.

## Apply and test
Overlay the included `src/`, `test/proxy.test.mjs`, and `bin-keyless.mjs` onto your latest checkout. From the repository root:

```bash
node --experimental-strip-types --test test/proxy.test.mjs
npm test
```

The CLI entry point can be invoked with:

```bash
node --experimental-strip-types bin-keyless.mjs daemon start --vault ~/.keyless/vault.json --socket ~/.keyless/daemon.sock
node --experimental-strip-types bin-keyless.mjs daemon status --socket ~/.keyless/daemon.sock
node --experimental-strip-types bin-keyless.mjs lock --socket ~/.keyless/daemon.sock
```

## Important scope limits
This is a minimum Gate 1c integration foundation, not the full grant/approval product. `addToken()` currently accepts a grant object from trusted local code; it does not implement interactive OS approval, project root binding, audit logging, token-file issuance, quotas, model filtering, query-parameter policy, SSE error normalization, or the complete provider schema validation. Do not expose daemon IPC beyond the current user's local machine. External security review remains required.

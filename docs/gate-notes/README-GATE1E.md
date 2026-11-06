# Keyless Gate 1e overlay

Base: `ace76ah/keyless` main at `9d39cb69cb9783e7f29032d0eee614e62ddaeff2`.

## Included

- `bin/keyless.mjs`: executable Node entry point.
- `src/cli/index.ts`: `init`, `add`, `grant`, `daemon start/status`, `proxy start`, `lock`, and `log`.
- `scripts/e2e-test.sh`: isolated HOME, real vault and daemon, grant IPC, proxy with mocked upstream, good/bad token assertions, and audit verification.

## Run

```bash
npm install
bash scripts/e2e-test.sh
```

The E2E flow intentionally starts the daemon before `grant`: the existing grant implementation persists tokens through daemon IPC, so granting before daemon startup is not possible with the current architecture. The script uses a mocked upstream and never contacts a provider.

`KEYLESS_PASSPHRASE` and `KEYLESS_SECRET` are supported for non-interactive automation. Do not use these environment variables for production secrets; they are intended for the isolated test harness. Interactive prompts hide typed characters.

This is an overlay ZIP. It does not include repository dependencies or replace unrelated files. No commit or push is performed.

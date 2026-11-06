# Keyless Gate 1b daemon overlay

These files are an overlay for the tested Gate 1a commit `0134104f83937e33c485264b1db240f7c73fa8da`.

## Files

- `src/daemon/ipc.ts` — newline-delimited JSON over Unix domain sockets or Windows named pipes.
- `src/daemon/server.ts` — opens the vault, serves `status`, `add`, and `lock`.
- `test/daemon.test.mjs` — spawns the daemon and exercises status/lock.

## Run the integration test

From the repository root, after `npm ci`:

```bash
node --experimental-strip-types --test test/daemon.test.mjs
```

The daemon reads its passphrase as one line from stdin (not from command-line arguments or environment variables):

```bash
node --experimental-strip-types src/daemon/server.ts --vault ./keyless.vault --socket ./keyless.sock
```

Write the passphrase followed by a newline to the daemon's stdin. On Unix, the socket is chmod'd to `0600`. On Windows, a named pipe is used; Node's core `net` API does not expose a portable per-user DACL setter, so the Windows pipe ACL must be reviewed separately before claiming equivalent access control.

This is an implementation overlay, not a claim that tests passed in this environment. It must be applied to the exact Gate 1a checkout and tested there.

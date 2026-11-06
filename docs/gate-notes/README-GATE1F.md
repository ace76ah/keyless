# Keyless Gate 1f overlay

Base repository: `ace76ah/keyless` main at `437d93b49ad53d3668464591f21c6736f5434505`.

## Files

- `README.md` — user-facing overview, threat-model limit, install/quickstart, architecture.
- `SECURITY.md` — actual crypto parameters and known limitations.
- `docs/threat-model.md` — implemented Gate 1 state and out-of-scope threats.
- `package.json` — package identity/version `keyless@0.1.0`, non-private package and executable mapping.
- `package-lock.json` — root package name/version synchronized.

## Apply and test

Overlay these files into the latest `main` checkout, then run:

```bash
npm install
npm test
bash scripts/e2e-test.sh
```

No source implementation files are changed. No commit or push is performed.

## Publishing note

The package name `keyless` may already be claimed on npm. Confirm availability and ownership before publishing. The README's global install command assumes publication under that exact package name. If unavailable, choose an available scoped package name and update the README and package metadata consistently.

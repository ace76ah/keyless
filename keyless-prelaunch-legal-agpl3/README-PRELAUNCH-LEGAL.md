# Keyless pre-launch legal overlay

Base repository: `ace76ah/keyless` main at `ce4c9c11e78f5e90bffed1a025d1fe153f58e0bc`.

Included:
- `LICENSE` — full GNU Affero General Public License v3.0 text (AGPL-3.0).
- `CONTRIBUTING.md` — DCO 1.1 sign-off requirement and `git commit -s` instructions.
- `package.json` — `"license": "AGPL-3.0"`.
- `package-lock.json` — synchronized root package license metadata.
- `README.md` — License section describing AGPL-3.0 core and separately offered commercial enterprise features.

Apply these files to the latest `main` checkout. No source implementation files are changed. No commit or push is included.

Suggested checks:

```bash
node -e "const p=require('./package.json'); if(p.license!=='AGPL-3.0') process.exit(1)"
npm install --package-lock-only
npm test
git diff --check
```

Before public release, have counsel or a qualified open-source licensing reviewer confirm that the project has the rights needed to license all included code under AGPL-3.0, including prior contributions and third-party code.

# Contributing to Keyless

Thank you for considering a contribution.

## Developer Certificate of Origin (DCO)

Contributions must be submitted with a **Developer Certificate of Origin (DCO) sign-off** on every commit. By signing off, you certify the statements in DCO version 1.1 below. This is a certification of origin and licensing rights; it is not a copyright assignment or a separate Contributor License Agreement.

Add the sign-off using Git's `-s` option:

```bash
git commit -s -m "Describe your change"
```

The resulting commit message must contain a trailer in this form:

```text
Signed-off-by: Your Full Name <your.email@example.com>
```

Use your real name and an email address that identifies you as the commit author. Do not add a sign-off on behalf of another person. If a commit is missing the trailer, amend it or create a correctly signed replacement before submitting the pull request.

Check your commits before opening a pull request:

```bash
git log -1 --format='%B'
```

All commits in a pull request must be signed off. Maintainers may ask contributors to rebase or amend commits that do not contain the required trailer.

## Developer Certificate of Origin, Version 1.1

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent
    with this project and the open source license(s) involved.
```

## Before submitting

- Keep changes focused and include tests for behavior changes.
- Run `npm test` and, where relevant, `bash scripts/e2e-test.sh`.
- Do not include real credentials, project tokens, vault files, audit logs or other private data in commits.
- Document security-sensitive changes and their threat-model implications.
- Report suspected vulnerabilities privately through GitHub's private vulnerability reporting feature if enabled; do not open a public issue containing exploit details.

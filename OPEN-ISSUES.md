# Open issues before the production build

Gate -1 compatibility spike is closed for the tested targets. Gate 0 design artifacts are drafted and committed. The remaining work below is deliberately separated from production implementation.

## Gate 0 validation and sign-off

- [ ] Run token-header integration tests with OpenAI Node SDK v4, Anthropic Node SDK and Aider. Gate -1 used dummy provider keys and did not validate the Keyless project-token header.
- [ ] Record exact Anthropic SDK and Aider versions from the owner's test environment.
- [ ] Validate SDK header precedence and prove the project token is stripped before upstream forwarding.
- [ ] Test 401, 403, 423 and 429 behavior with real SDKs/agents; confirm no locked-vault retry loop.
- [ ] Verify `keyless use` output and the optional `.keyless/agent-instructions.md` behavior with Aider and a direct SDK example.
- [ ] Obtain an external human security review of `docs/threat-model.md`, `docs/approval.md`, `docs/protocol.md` and `docs/network.md`; record the reviewer and resolutions in `DECISIONS.md`.

## Gate 1 / security and platform validation

- [ ] Benchmark the Argon2id default on supported developer hardware; keep min/max bounds and worker-thread execution.
- [ ] Select and review maintained Argon2id, XChaCha20-Poly1305 and HKDF-SHA-256 libraries.
- [ ] Validate the 72-byte vault header and AAD with test vectors; test wrong passphrase, header tamper, KDF floor/ceiling, corruption and newer-format refusal.
- [ ] Prove atomic replacement and OS-backed exclusive locking under crash and concurrent-writer tests.
- [ ] Prototype pinned-IP connections with TLS SNI and normal hostname verification using the chosen HTTP client. Failure to preserve verification is a release blocker.
- [ ] Implement and test macOS LocalAuthentication, Windows Hello, Linux polkit and caller-TTY fallback. Headless grant/reveal remains unsupported.
- [ ] Confirm Windows named-pipe ACLs, token-file DACLs and file replacement semantics.

## Gate 2 / operational controls before release

- [ ] Define numeric transport quota defaults, request/response byte limits, timeout and concurrency policy.
- [ ] Define audit retention/rotation and validate the hash-chain limitation.
- [ ] Define encrypted backup/export and restore behavior, including revoked-token handling.
- [ ] Define daemon crash behavior for in-flight requests, audit writes and half-applied approvals.
- [ ] Complete provider-specific request/response header allowlists, query parameter patterns, model allowlists and SSE error mapping.
- [ ] Add path normalization, DNS rebinding, redirect, request-smuggling and credential-stripping adversarial tests.
- [ ] Decide the license and verify GitHub/npm naming before public release.

## Closed: Gate -1

- [x] OpenAI Node SDK v4 base-URL routing.
- [x] Anthropic Node SDK base-URL routing.
- [x] Aider CLI routing through the custom OpenAI-compatible base URL.
- [x] Path prefix `/c/<alias>/...` selected.
- [x] Cursor Free-tier custom endpoint paywall and built-in-model bypass documented; IDE interception/system packet interception out of v1 scope.

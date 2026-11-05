# Keyless threat model

**Status: Gate 0 design draft — requires external human security review before production implementation.**

This document defines the security claims Keyless may make and the claims it must not make. The threat model is intentionally narrow: Keyless reduces accidental credential exposure and limits approved credential use. It does not sandbox an agent or isolate hostile code running as the same user.

## 1. Security objective

Keyless keeps provider credentials out of ordinary agent configuration, source files, chat context, command output and routine logs. A local daemon stores the vault, checks project grants, and attaches the provider credential only when it forwards an approved request.

The product objective is **reduce accidental exposure and limit blast radius**, not prevent every possible use of a credential by software running with the developer's OS privileges.

## 2. Assets

- Provider credentials stored in the encrypted vault.
- Master passphrase and derived vault keys.
- Project capability tokens and token lifecycle metadata.
- Vault-held grants: provider, host, methods, paths, model/query allowlists and transport caps.
- Approval records and audit metadata.
- Integrity of the vault and daemon state.

## 3. Trust boundaries and principal components

1. **Developer / human:** owns the machine, approves grant changes and unlocks the vault.
2. **CLI:** obtains passphrases through a hidden terminal prompt; asks the daemon to create credentials, grants and project tokens.
3. **Daemon:** sole owner of the unlocked vault, decrypted credentials, session state, token validation, authoritative grants and proxy listener.
4. **Project / agent process:** local code that may know the base URL and read the project-token file. It does not receive provider credentials as part of the normal request flow.
5. **Provider endpoint:** fixed origin shipped in the Keyless package. The client never chooses the upstream host.
6. **OS security services:** protect user files and provide approval prompts where available.

The project configuration file is untrusted input. It is a request, not an authorization record. The daemon compares it with the vault-held grant and refuses unapproved expansion.

## 4. In scope: what Keyless aims to defend against

- Accidental pasting of provider keys into agent chats, source code, .env files or normal terminal output.
- An agent modifying a project request file to silently expand its own permissions.
- A request attempting to use a credential against a host, method, path, query parameter or model outside the vault-held grant.
- A request attempting to override the provider host or supply an absolute URL.
- SSRF, DNS rebinding and redirects intended to send provider credentials to an unapproved destination.
- Caller-supplied authentication headers attempting to override Keyless provider credentials.
- Header injection, request framing abuse, oversized requests, slow clients and uncontrolled concurrency.
- A locked, expired or revoked state causing an agent to hang or retry indefinitely.
- Accidental credential exposure through ordinary logs, normalized errors or audit records.

## 5. Out of scope: what Keyless does not defend against

- **Arbitrary code execution as the same OS user.** Such a process can read the project-token file, call the loopback proxy, inspect accessible files, attach a debugger where the OS allows it and inspect unlocked process memory. Per-project tokens and grants limit accidental cross-project use; they do not stop a malicious same-user process.
- Root/administrator access, a compromised kernel, firmware malware or a compromised machine.
- Malicious dependencies intentionally running with the user's privileges.
- Prompt injection that fully controls the developer's interactive terminal or can manipulate the human into approving a request.
- Provider-side data handling, model behavior, service compromise or what an authorized provider request returns.
- Preventing an authorized application from sending sensitive user data in its request body.
- Protecting secrets after a user deliberately reveals/copies them into an agent-controlled terminal or clipboard.
- Remote development environments, hosted coding agents, Docker/dev containers and network clients that cannot reach the same-machine loopback service in v1.
- IDE-hosted inference traffic that does not expose an officially supported custom endpoint. Keyless does not use packet interception, TLS interception or a system proxy to reroute it.

## 6. Project identity, tokens and grants

### Project identity

- Each project receives a random 128-bit project ID during `keyless init`.
- The daemon canonicalizes the project root using the OS real-path API and computes a SHA-256 path binding. The raw path is stored only inside the encrypted vault where needed; schemas and audit output use the project ID or path digest.
- A copied project directory does not automatically inherit the original project's authority. A path mismatch requires a new project registration and grant review.
- Symlinks are resolved before project identity is calculated. A project moved or renamed must be re-registered.

### Project capability token

- Generated from 32 bytes of OS CSPRNG entropy; encoded as `klp_v1_<base64url>`.
- Issued only after an approved grant exists.
- Stored in a user-owned Keyless state directory outside the repository. On POSIX, directory mode 0700 and file mode 0600; Windows uses an owner-only DACL.
- The vault stores the token ID and SHA-256 digest, not the plaintext token.
- Sent to the local proxy as `Authorization: Bearer <project-token>`. The daemon validates it before policy evaluation and never forwards it upstream.
- Default expiry is 30 days. Revocation is immediate at the daemon's next authorization check.
- A token is a local capability. Because the agent commonly runs as the same OS user, the agent may be able to read it. Treat it as scoped and revocable, not invisible or unstealable.

### Authoritative permissions

- `keyless.config.json` states the access the project requests.
- The grant stored in the encrypted vault is authoritative.
- The daemon matches project ID, alias, provider, host, method, normalized path, query parameter names, model and transport caps against the authoritative grant on every request.
- A wider request file has no effect until a human approves the exact normalized diff through `keyless grant`.
- Project tokens cannot create grants or widen their own authority.

## 7. Daemon session and secret handling

- One daemon owns the decrypted vault and proxy listener. CLI clients use a local Unix-domain socket on macOS/Linux and a named pipe on Windows, protected by OS ACLs and peer identity checks.
- Unlock session default is eight hours. Inactivity locking is off by default in v1; explicit `keyless lock` invalidates session state.
- A locked vault fails fast with HTTP 423 `vault_locked`; the proxy does not wait for an unlock.
- Re-unlock does not require restarting the agent.
- Plaintext provider credentials remain in daemon memory only while the vault is unlocked. The JavaScript runtime cannot guarantee perfect zeroization or prevent same-user memory inspection. A native secure-memory implementation is not a v1 claim.
- Disable production inspector/heap-snapshot entry points and core dumps where supported, but document these as defense-in-depth, not a guarantee of memory isolation.
- No credential values, project-token contents, request bodies or raw upstream error payloads are logged.

## 8. Network request security

The detailed algorithm is in [network.md](network.md). The required high-level sequence is:

1. Parse an origin-form HTTP request only. Reject absolute-form targets, authority overrides and unexpected host headers.
2. Extract the alias only from the /c/<alias>/ path prefix. Resolve the provider from the package's built-in registry; never accept a caller-supplied upstream hostname.
3. Normalize the path exactly once. Reject encoded separators, NUL, backslashes, repeated separators and dot segments before grant matching.
4. Check the project token, vault unlock state and authoritative grant before reading or forwarding a body.
5. Validate method, pathname, query parameters and model against provider and grant allowlists.
6. Resolve the fixed provider hostname, reject non-public IP ranges and connect to a validated/pinned address with TLS SNI and certificate verification bound to the original hostname.
7. Strip caller auth/forwarding/cookie/host headers; add only the provider credential from the vault.
8. Disable redirects, bound sizes/timeouts/concurrency, and propagate client cancellation.
9. Forward SSE incrementally with backpressure. Normalize mid-stream provider errors without exposing secrets.
10. Record metadata-only audit entries.

The listener binds only to loopback. Non-null browser Origin values are rejected. Host and Origin checks are defense-in-depth; neither is authentication.

## 9. Human approval

Grant expansions, destructive credential operations and reveal actions require an interactive human approval path described in [approval.md](approval.md).

- The approval UI shows the exact before/after grant, including hosts, methods, paths, queries, models and caps.
- The approved diff is canonicalized and SHA-256 hashed. The hash is tied to project ID, request digest, current grant revision and a short-lived challenge nonce; it is stored with the grant and audit event.
- If the request changes between preview and confirmation, approval is discarded and a new diff is shown.
- macOS uses LocalAuthentication where available; Windows uses Windows Hello; Linux uses a polkit authentication agent where configured. Caller-terminal fallback is weaker and is not proof of human presence.
- Headless/CI grant expansion and reveal are unsupported in v1.

## 10. Known limitations and v1 platform decisions

- **IDE interception:** out of scope. The owner observed Cursor Free-tier custom endpoint calls returning a subscription paywall error; built-in Cursor models bypassed the custom base URL and used Cursor's cloud route. GitHub Copilot was not tested and is not a v1 target. These are scope decisions, not claims about every IDE plan.
- **Docker/dev containers:** not supported in v1. The agent and daemon must run on the same host and use host loopback.
- **Remote development / SSH / hosted agents:** not supported in v1 because remote processes cannot use a developer machine's loopback endpoint as if it were local.
- **Windows:** intended v1 support using named pipes, owner-only ACLs and Windows Hello; it requires platform-specific implementation and tests.
- **Sleep/logout:** the daemon must lock on user logout. V1 session behavior across sleep is a known risk; the implementation must decide whether to lock on suspend and document it before release.
- **In-flight request during lock:** stop admitting new work immediately; abort existing requests and streams within a bounded five-second grace period.
- **Same-user approval:** even biometric or OS-native prompts do not make the local agent a separate OS principal. A fully controlling agent may interact with a fallback terminal prompt or ask the user to approve something misleading.

## 11. Security review and release gate

An external human security reviewer must review and sign off on this document, [approval.md](approval.md), [protocol.md](protocol.md) and [network.md](network.md) before v1 release. Passing automated tests is not a substitute for that review.

Do not ship v1 if pinned-IP networking cannot preserve normal TLS hostname verification, if an agent loops on `vault_locked`, or if no qualified reviewer signs off on the security boundary.

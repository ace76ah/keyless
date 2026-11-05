# Keyless network and upstream request rules

**Status: Gate 0 engineering contract — must be reviewed and implemented with adversarial tests.**

The mock proxy is not this network client. The rules below apply to the production daemon only.

## 1. Listener and request target

- Bind only to §127.0.0.1§ and §::1§; do not bind to wildcard interfaces or LAN addresses.
- Use a dynamically assigned loopback port and write it to the daemon state file with owner-only permissions. §keyless proxy status§ reports the actual address.
- Accept origin-form request targets only. Reject absolute-form URLs, authority-form targets, Host overrides and protocol upgrade requests.
- Require a valid Host header matching the exact loopback listener address and port. This is defense-in-depth, not authentication.
- Reject requests with an §Origin§ header other than the literal §null§. Browser access is not supported; do not add permissive CORS headers.
- Authenticate the project token before reading a potentially large body.

## 2. Alias and path normalization

1. Extract the alias from the first path segment after §/c/§. Alias syntax is lower-case ASCII letters, digits, underscore and hyphen; no percent encoding.
2. Resolve the alias only against the built-in provider registry and the project's vault-held grant.
3. Separate the query string from the pathname before policy matching.
4. Reject percent-encoded slash/backslash (§%2f§, §%5c§, case-insensitive), NUL, literal backslashes, invalid percent escapes and repeated slash separators.
5. Percent-decode path segments exactly once. Reject segments equal to §.§ or §..§, including encoded forms, and reject any path that changes meaning after normalization.
6. Match only the normalized pathname, never the full URL or query string, against a segment-aware grant pattern.
7. Grant glob syntax is intentionally narrow: §*§ may appear only as a complete path segment and matches exactly one non-empty segment. No partial wildcards, recursive §**§, regex paths or prefix matching. Exact match is preferred.

## 3. Provider and grant validation

- Provider definitions ship inside the package and contain literal HTTPS hostnames. No user-defined provider hostnames, wildcard hosts, templates or URL overrides in v1.
- The grant's provider ID must match the alias request. The grant may only narrow the provider definition.
- Validate HTTP method, normalized pathname, query parameter names and values, model identifier and transport caps against both provider definition and vault-held grant.
- Query values are validated against provider-owned anchored patterns. Do not execute user-supplied regex. Unknown query parameter names are rejected.
- Model checks read only the documented model field for supported JSON request types; no prompt parsing, token counting or body-based spend estimation in v1.
- Strip or reject caller-supplied host-routing fields and absolute URL controls before constructing the upstream request.

## 4. DNS and TLS algorithm

For every new upstream connection (or cache entry within a documented short TTL):

1. Resolve the exact provider hostname using the system resolver.
2. Parse all returned A and AAAA addresses. Reject if any answer is loopback, private, link-local, multicast, unspecified, reserved, IPv4-mapped loopback/private, or a known metadata-service address. Do not silently choose a public answer from a mixed public/private set.
3. Select one validated IP and pin the socket connection to that exact address. Do not allow the HTTP client to perform a second unvalidated DNS lookup.
4. Set TLS SNI to the literal provider hostname, not the pinned IP.
5. Keep certificate-chain validation enabled and verify the certificate hostname against the same literal provider hostname using the standard hostname verifier (§checkServerIdentity§ or the client's equivalent).
6. Require TLS 1.2 or later. Never add a "skip certificate verification" fallback.
7. Set the HTTP Host header to the literal provider hostname.
8. Do not inherit §HTTP_PROXY§, §HTTPS_PROXY§, §ALL_PROXY§ or other ambient proxy variables. V1 connects directly to the pinned IP. A proxy mode would require a separate reviewed design.

If the chosen HTTP client cannot pin the connection while preserving SNI and normal certificate verification, do not ship it. A failed test is a release blocker, not a reason to weaken TLS.

## 5. Headers and credentials

- Build upstream headers from a provider-specific allowlist.
- Remove inbound §Authorization§, §Proxy-Authorization§, §Cookie§, §Host§, §Forwarded§, §Via§, all §X-Forwarded-*§, §X-Api-Key§, and provider-specific credential headers.
- Remove the Keyless project-token header before forwarding.
- Add the credential header from the vault only after the destination host and grant have been validated.
- Never place credentials in query parameters, path segments or request bodies.
- Reject CR/LF, invalid token characters and duplicate security-sensitive headers.
- Forward only provider-required headers after validation, such as Anthropic's version header. Strip hop-by-hop headers.
- Prevent request smuggling by rejecting conflicting §Content-Length§ and §Transfer-Encoding§, invalid framing and unsupported transfer codings. Do not forward raw connection-specific headers.

## 6. Redirects and upstream responses

- Disable automatic redirect following. V1 refuses 3xx responses rather than following them.
- Never resend a provider credential to a second host.
- Apply response-header allowlists; never forward §Set-Cookie§, hop-by-hop headers or credential-bearing headers to the local caller.
- Normalize provider errors to the Keyless error envelope. Remove request IDs or upstream text if they may include credentials or sensitive bodies.
- Never log upstream response bodies.
- For SSE, parse event frames incrementally, preserve data frames required by the SDK, normalize known mid-stream error events, and never buffer the entire stream.
- Propagate local client cancellation to the upstream request. Enforce backpressure and bounded stream lifetime.

## 7. Limits and auditing

- Enforce request/response byte limits, header limits, idle/request timeouts, per-project request rate, per-credential daily request cap and maximum concurrent requests.
- V1 quotas are transport-level. Do not infer token counts or cost from prompt bodies.
- Audit metadata only: timestamp, project ID, alias, provider host, method, normalized path, status, duration, byte counts and decision code. No body, authorization header, query values or credential material.
- Audit integrity is tamper-evident, not tamper-proof. The daemon maintains a SHA-256 hash chain; local administrator access can still delete the log and chain state.

## 8. Required adversarial tests

- Absolute URL and Host override attempts are rejected.
- Encoded traversal, encoded separators, NUL, backslash, repeated slashes and partial wildcard bypasses are rejected.
- DNS answers containing loopback, private, link-local, multicast or metadata addresses are rejected.
- The TCP peer is the pinned IP while SNI and certificate hostname validation use the approved provider hostname.
- Valid certificates pass; invalid, expired and wrong-host certificates fail.
- Redirects are not followed and credentials never reach a second host.
- Caller Authorization, project token, x-api-key, Cookie and Forwarded headers never reach upstream.
- Query names and values outside provider allowlists are rejected.
- Conflicting request framing is rejected.
- Request/response caps, timeouts, cancellation, SSE first-frame latency and stream error normalization are verified.
- No network connection is made except to the exact built-in provider origin selected by the grant.

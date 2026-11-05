# Gate 0 project-token validation

**Status: reference contract harness added; production integration remains pending.**

The test suite in \`test/project-token-contract.test.mjs\` is an executable in-memory reference fixture. It models the proposed project-token contract against a local fake upstream. It is not the production daemon, does not read the encrypted vault, and does not prove SDK-specific header behavior.

## What this harness checks

- SHA-256 digest-only token record and constant-time digest comparison.
- Missing, malformed, incorrect, expired and revoked token rejection (401).
- Provider grant rejection before upstream work (403).
- Path alias stripping (\`/c/<alias>\`).
- Removal of the project bearer, caller-supplied \`x-api-key\`, cookies and forwarding headers.
- Insertion of the correct provider credential at the fake upstream.
- Preservation of the Anthropic version header.
- Safe error response shape and absence of secrets in captured upstream requests.

## What it does not prove

- Official OpenAI or Anthropic SDK header precedence.
- Aider's exact Authorization header behavior.
- Real vault lookup, token issuance, revocation persistence or OS file permissions.
- Provider network/TLS behavior, streaming, request cancellation or daemon lifecycle.
- Production readiness or resistance to malicious code running as the same OS user.

## Next acceptance tests

1. Pin exact OpenAI SDK, Anthropic SDK and Aider versions.
2. Drive the harness using those real clients, capture raw inbound headers, and assert the project token arrives in the reserved bearer header.
3. Test the exact Anthropic placeholder/API-key precedence behavior.
4. Replace the fixture with the production daemon as soon as its auth and forwarding interfaces exist; keep the same black-box assertions.
5. Run negative tests for 401, 403, 423 and 429 through each client and check bounded retry behavior.

The harness intentionally uses test-only credentials and a fake loopback upstream. No real provider key is needed or should be supplied.

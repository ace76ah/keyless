# Keyless decisions

This file separates decisions from assumptions. The product and protocol are not frozen during Gate -1.

| Topic | Status | Current position | What closes it |
|---|---|---|---|
| Local-first v1 | DECIDED | No hosted account or cloud vault in v1. | No further action. |
| Production code layout | PROPOSED | One TypeScript package; no v1 monorepo. | Gate 0. |
| Gate -1 prototype | DECIDED | Throwaway Node mock only; no stored or forwarded credentials. | Automated checks and local agent tests. |
| Primary workflow | PROPOSED | App/Tool Mode: code running locally calls the loopback service. | Test Cursor and Claude Code locally. |
| Agent-Inference Mode | OPEN | A separate optional workflow for local agents supporting custom base URLs. | Test actual local CLI behavior. |
| Alias carrier | OPEN | Compare `/c/<alias>/...` with `X-Keyless-Credential`. | SDK and agent spike results. |
| Streaming in first useful demo | OPEN | Mock includes a small SSE example so this can be tested. | Record real SDK/agent observations. |
| Vault cryptography | PROPOSED | XChaCha20-Poly1305 and bounded Argon2id. | Vault-format specification and review. |
| Human approval | PROPOSED | OS-native approval where supported; weaker fallbacks must be disclosed. | Approval specification and security review. |
| Supported agents | OPEN | Do not claim broad support before Gate -1. | Evidence from tested versions. |
| License | OPEN | No license chosen yet. | Owner decision before public release. |
| npm package name | OPEN | Package is private in this spike; no publishing. | Availability and name review. |

## Current boundary

The spike is not the production Keyless security boundary. It has no vault, no grant store, no credential handling and no provider network client.

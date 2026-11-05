# Why Keyless exists

I want a better way to let AI-assisted projects use API credentials without pasting those credentials into chat, source files or agent-visible configuration. Keyless is meant to reduce accidental exposure and limit the blast radius of credential use.

Keyless v1 is a local-first credential broker for direct SDK integrations and local CLI coding agents that support custom API base URLs. The owner validated the mock routing approach with the OpenAI Node SDK, Anthropic Node SDK and Aider CLI. IDE-hosted inference interception, system-level packet interception, hosted agents and remote clients are outside v1 scope.

Keyless keeps provider credentials in an encrypted local vault and checks vault-held project grants before forwarding a request to a built-in provider host. Project config is only a request; it cannot grant itself access. The project capability token is stored in a private file outside the project and its hash/lifecycle metadata are held in the vault.

Keyless does **not** prevent a malicious process running as the same OS user from reading the project token, calling the loopback proxy, accessing local files, attaching a debugger where permitted, or inspecting process memory. OS approval is a meaningful human checkpoint against casual file edits and some prompt-injection paths, but it is not proof of human presence against a fully controlled terminal. Keyless also does not protect against root/admin, malware or a compromised machine.

## Kill criteria

1. If supported SDKs and CLI agents cannot send the Keyless project token in the reserved Authorization header without leaking it upstream, narrow or redesign the integration before implementation.
2. If an external human security reviewer will not sign off on the threat model, approval design and network protocol, do not ship v1.0.
3. If pinned-IP connection and normal TLS hostname verification cannot both pass against a real upstream, do not ship the production proxy.
4. If the locked-vault error causes agents to retry in a loop, fix the protocol before release.
5. If the chosen OS approval path can silently approve an expanded grant without presenting the bound permission diff, do not ship grant expansion.

These are product constraints, not claims that any production security review or credential isolation test has already passed.

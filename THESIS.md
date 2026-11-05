# Why Keyless exists

I want a better way to let AI-assisted projects use API credentials without pasting those credentials into chat, source files or agent-visible configuration. Keyless is meant to reduce accidental exposure and limit the blast radius of credential use.

Keyless does not prevent a malicious process running as the same operating-system user from using an available local service, reading files it can access or inspecting process memory. That limitation needs to stay visible in the product and its documentation.

## Kill criteria

1. If Gate -1 shows the two target workflows cannot use the local service without per-task approval that makes the workflow impractical, narrow the product to a review-before-use model.
2. If an external human security reviewer will not sign off on the threat model, approval design and network protocol, do not ship v1.0.
3. If pinned-IP connection and normal TLS hostname verification cannot both pass against a real upstream, do not ship the production proxy.
4. If the locked-vault error causes agents to retry in a loop, fix the protocol before release.

These are product constraints, not claims that any production security review has already happened.

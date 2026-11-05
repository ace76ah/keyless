# Open issues before the production build

- [ ] Run Gate -1 with the owner's actual Cursor installation in App/Tool Mode.
- [ ] Run Gate -1 with the owner's actual Claude Code installation in App/Tool Mode.
- [ ] Test Agent-Inference Mode separately; do not mix it with App/Tool Mode.
- [ ] Compare path alias and header alias with both provider SDKs.
- [ ] Record the exact SDK and agent versions used.
- [ ] Decide whether streaming is required for the first useful release.
- [ ] Decide what `keyless use <alias>` should print or write based on observed agent behavior.
- [ ] Decide the error wording that prevents repeated retries when the vault is locked.
- [ ] Finalize v1 commands, including the v1 revoke operation and generated-secret reveal path.
- [ ] Finalize the project identity and grant model.
- [ ] Write and review the protocol, threat model, approval, vault-format and network specifications.
- [ ] Identify an external human security reviewer before implementation gates that require sign-off.
- [ ] Decide license and verify GitHub/npm naming before public release.

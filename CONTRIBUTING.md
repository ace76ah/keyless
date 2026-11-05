# Contributing

Thanks for taking a look. Keyless is still being worked out, so the most useful contributions at this stage are reproducible observations from the Gate -1 spike, clear bug reports and small fixes.

Before opening a change:

1. Run `npm test` and `npm run check`.
2. Keep the mock local-only. It must not store credentials or make upstream requests.
3. Do not add real API keys, tokens or private project data to examples, fixtures or notes.
4. Keep security claims tied to behavior that can be tested.

For larger changes to the protocol, vault format or approval model, open a discussion before implementing them.

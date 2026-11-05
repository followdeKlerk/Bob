# Tool-schema builder conversion

Bob's tool definitions use the public `@earendil-works/pi-schema` builders. This replaces the application TypeBox dependency; it does not upgrade Pi Durable, change document/task versions, or migrate native data.

## Input compatibility

Existing permissive objects deliberately use `obj(properties, {open:true})`; `obj` is closed by default. Closed delegation and visual-action objects remain closed. When extending an already-built tool schema, retain its `required` list: the builder's optional-property wrappers are not present in its emitted `properties`. Opaque MCP arguments and visual data remain arbitrary JSON records. Native Pi validation still owns coercion and copy-on-validate.

The committed pre-conversion schema fixture covers the complete default tool set and all three delegation modes. Regression tests compare the schemas (normalizing only equivalent literal, single-union and opaque-record encodings) and more than a thousand input outcomes, including bounds, omissions, unknown keys and mutation protection.

## Exact persistence-compatible update

The deployed supervisor hashes full task-bearing files, so the three package import/schema changes alter its raw source compatibility fingerprint even though their document, task and executor definitions are unchanged.

The maintenance policy recognizes one explicitly reviewed same-format alias:

- Raw converted source: `95750e8918ed663e0607933a0e3867674fec8098d32981b45008b15806a072f9`
- Existing persistence identity: `5c798ab849e5ebf456f1aa4da70f8ef88f87af72bd8e709292083776ba1d0b45`

`rawCompatibilityFingerprint` still hashes the complete files and exact runtime dependency versions. Only that complete raw digest receives the existing identity. No source normalization, caller override or wildcard is allowed. Every other changed digest remains distinct and is refused by the existing transition gate. Full-release `sourceHash` remains independent and distinguishes builds.

Install the policy first with the three fingerprinted package files unchanged, through normal supervised update. Verify the actual running supervisor before applying those final three package conversions and removing their remaining TypeBox dependencies. Freeze source during each build. The target retains the same policy.

The historical Pi 1.4→1.5 floor and original migration intent must remain untouched. This conversion uses the ordinary same-format backup, drain, ownership, health-check and code-fallback path. Never restore chat databases or run Pi 1.4 against upgraded state. Packaged tests must prove bidirectional Pi 1.5 recovery before relying on the alias.

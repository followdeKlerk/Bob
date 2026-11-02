# Pinned Hermes strict memory threat scan

This write-time TypeScript port uses Nous Research's MIT-licensed Hermes Agent,
pinned to `bf0203a794a07aac3ff764972ab9087baa4e4f4e`.

- `upstream/tools/threat_patterns.py`: complete original pattern library.
- `upstream/tools/memory_tool_store.py`: original `_scan_memory_content`, add,
  full-result patch, dry-run batch and load-time behavior for reference.
- `upstream/tests/tools/test_threat_patterns.py`: original scanner regressions.
- `upstream/LICENSE`: original MIT notice, also included in the port's source header.
- `provenance.json`: source repository, commit, SHA-256 hashes and Git blob IDs.

The retained Python files are provenance/test data, not Bob runtime modules. The
TypeScript implementation is `packages/resources/src/threat-patterns.ts`. It keeps
all 36 strict-scope patterns and IDs in upstream order, including the cumulative
`all` and `context` scopes. Its raw pattern rows are checked verbatim against the
pinned Python module by the differential test.

## Deliberate adaptations

- Scan only **new adds and each complete patched entry**, not only patch fragments.
  The shared operation walk runs for foreground writes, unattended proposal dry
  runs, and approval replay. An unsafe op fails before the batch or proposal is
  persisted; later removal of the offending result does not bypass scanning.
- Bob-native Durable documents, atomic commits, operation receipts, exact-span
  whitespace, pinned matched entries, final batch budgets and existing owner
  authorization remain authoritative. There is no new approval gate, document
  schema, background policy or change to how learning is scheduled.
- NFKC is applied only to a bounded scan copy, never stored content. The upstream
  65,536-character cap counts Unicode codepoints, before normalization.
- Python Unicode `\w` and `\b` are translated to letter/number/underscore category
  tests and explicit Unicode boundaries; `\s` uses Python's whitespace set, not
  JavaScript's (notably U+001C–001F, U+0085 and BOM). Translation is character-class
  aware. Python's escaped apostrophe/tilde are unescaped for JavaScript Unicode
  regex syntax.
- Scoped case-sensitive category tests prevent JavaScript `/iu` from admitting
  combining U+0345 through its case-fold to Greek iota. They use Bob's required
  Node 24 runtime. Dotted/dotless I are folded in the scan copy to reproduce
  Python IGNORECASE's additional ASCII-range matches. The hardcoded-secret rule's
  uppercase environment-variable-name exemption is tested case-sensitively
  against the **original normalized value**, not that folded copy.
- Multiple invisible findings are returned in first-occurrence order. Python's
  set intersection has unspecified order; the differential comparison sorts
  findings. Single-finding refusal wording matches upstream.
- Existing Bob separator, invisible/bidirectional control, and provider-key checks
  remain in place; some of these predate this port and are stricter than Hermes.

## Verification

From the repository root:

```sh
node --import tsx --test test/memory-threats.test.ts test/memory-threat-patterns.test.ts
npm run build -w @bob-local/resources
node --import tsx --test test/learning-skills.test.ts test/learning.test.ts
```

The tool tests exercise real Durable commits and operation receipts in isolated
`MemoryStorage`, not production state. They cover injection/exfiltration,
assembled-patch attacks, staged-batch rejection, legacy proposal approval rescan,
owner/peer checks, normal/code-related facts, NFKC storage preservation, receipt
replay, exact whitespace, unchanged rejected batches and removable legacy facts.

The differential test verifies source hashes and all raw patterns, and compares
204 synthetic strings against the pinned standalone Python scanner: all 36
positive pattern fixtures, benign code facts, uppercase and full-width variants,
Unicode whitespace, invisible controls, word boundaries, case-folding,
environment-variable-name exceptions and codepoint caps. It invokes only the
vendored standalone stdlib scanner via isolated Python (`python3 -I`); it does not
import Hermes memory/agent/config code, inspect credentials, contact endpoints,
or execute commands embedded in fixtures. Python 3 is required for this test,
not for Bob's runtime.

## Known limitations / intentionally not implemented

**Read/render/load sanitation remains unsupported.** Hermes sanitizes its frozen
system-prompt view at load time while retaining original persisted entries. This
mutation-only change does not add that behavior to Bob: existing stored entries
remain readable/renderable as untrusted reference data and are never silently
rewritten, deleted or migrated. Unrelated safe mutations and explicit removals
remain possible even if another legacy entry is unsafe. Any separate render-time
sanitation feature needs an explicit integration decision, including frozen
system-section behavior; passing these tests does not claim that parity.

The scanner is heuristic, not a semantic proof against injection or a general
secret detector. Strict scope can reject legitimate prose quoting attack/C2
vocabulary, exactly as upstream does. It does not fold cross-script confusables;
its upstream cap does not inspect text beyond 65,536 codepoints. Python and Node
supply their own Unicode database versions; the differential corpus verifies the
listed cases, not every codepoint/version combination. No production memory was
probed, and no deployment or application build/install is part of this change.

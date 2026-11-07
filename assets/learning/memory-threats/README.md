# Memory scanner provenance

Bob adapts the strict memory scanner from [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/bf0203a794a07aac3ff764972ab9087baa4e4f4e), pinned to commit `bf0203a794a07aac3ff764972ab9087baa4e4f4e`, MIT © 2025 Nous Research.

`upstream/` retains the original pattern library, memory-store reference, tests and `LICENSE`. `provenance.json` records source hashes and Git blob IDs. Bob's runtime implementation is `packages/resources/src/threat-patterns.ts`, not the upstream Python agent. See [third-party notices](../../../THIRD_PARTY_NOTICES.md).

## Adaptations and limits

Bob scans new memory entries and complete patched results before saving. Normalisation affects only a temporary scan copy, not stored text. Python Unicode and regular-expression behaviour is translated for Node, with differential tests for pattern order, boundaries, whitespace, case-folding and codepoint limits.

The scanner is heuristic: it can reject legitimate quotations and is not a general secret detector or proof against prompt injection. Existing entries are not silently rewritten or deleted. Read/render-time sanitation is not implemented, and text beyond the upstream 65,536-codepoint scan cap is not inspected by this scanner. Passing a finite differential corpus does not establish parity across every Unicode version or character.

## Verification

```sh
node --import tsx --test test/memory-threats.test.ts test/memory-threat-patterns.test.ts
```

Tests check pinned source hashes and patterns, compare synthetic cases with the standalone upstream scanner, and exercise isolated memory mutations. The differential test requires Python 3; Bob's runtime does not. It runs the vendored standard-library scanner, not upstream agent/configuration code, and does not inspect production state or credentials.

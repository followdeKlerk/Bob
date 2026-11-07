# Learning prompt provenance

Bob adapts review, `/learn` and `/refine` prompts from [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/bf0203a794a07aac3ff764972ab9087baa4e4f4e), pinned to commit `bf0203a794a07aac3ff764972ab9087baa4e4f4e`, MIT © 2025 Nous Research. The `/learn` source also credits the knowledge-base layout to [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill).

This directory retains original source bytes and tests under `upstream/`, the upstream `LICENSE`, and source hashes/Git blob IDs in `provenance.json`. The live adapted module is `src/learning-prompts.ts`; these Python agent files are not imported or executed by Bob.

## Adaptations

`adaptations.json` records the ordered text substitutions: Bob's native memory and skill stores replace upstream files, tool names match Bob's available tools, and authoring/lifecycle guidance follows Bob's native permissions. The prompts do not themselves grant permissions or enforce approval rules.

The extraction script parses Python literals with the standard-library AST parser; it does not import the agent or evaluate arbitrary code. It preserves prompt ordering and treats user-supplied request text as literal text rather than a format string.

## Verify or regenerate

From the repository root:

```sh
python3 assets/learning/port.py --check
python3 assets/learning/port.py
node --import tsx --test test/learning-prompts.test.ts
```

The first command checks hashes and the existing port. The second regenerates the owned TypeScript prompt file. Retained source, licence and provenance files should stay together; see [third-party notices](../../THIRD_PARTY_NOTICES.md).

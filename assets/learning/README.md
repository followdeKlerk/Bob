# Learning prompt provenance

The live prompt module is `src/learning-prompts.ts`. This directory is an audit
and regeneration artifact, not a prompt loader, instruction source, or Python
runtime dependency for Bob. No upstream agent module is imported or executed.

## Pinned originals

- Repository: <https://github.com/NousResearch/hermes-agent>
- Commit: `bf0203a794a07aac3ff764972ab9087baa4e4f4e`
- Local source reviewed: `/home/ndk/.hermes/hermes-agent`
- `git rev-parse HEAD` matched that pin and `git status --porcelain` was empty
  at extraction. Each working-copy source was also compared byte-for-byte with
  `git show <commit>:<path>` before copying.
- `provenance.json` records the SHA-256 and Git blob ID of every original.
- `upstream/agent/background_review.py`: review constants, shared memory and
  skill-authoring blocks, and the exact explicit-review focus suffix.
- `upstream/agent/curator.py`: the opt-in class-level consolidation prompt.
- `upstream/agent/learn_prompt.py`: authoring, knowledge-base, source-hygiene
  constants and the complete `/learn` builder.
- `upstream/tests/agent/test_learn_prompt.py` and `test_refine_focus.py`: original
  behavior regressions retained for audit. Their prompt-builder assertions are
  ported into `test/learning-prompts.test.ts`; upstream runtime/CLI wiring is not
  implemented or exercised by this isolated prompt module.
- `upstream/LICENSE`: MIT, Copyright (c) 2025 Nous Research. The same notice is
  included in `THIRD_PARTY_NOTICES.md`. The `/learn` source also acknowledges
  the knowledge-base layout after `virgiliojr94/book-to-skill` (MIT).

## Extraction and exact substitution

```sh
python3 assets/learning/port.py --check  # verify original hashes and exact port
python3 assets/learning/port.py          # regenerate the owned TypeScript file
node_modules/.bin/tsx --test test/learning-prompts.test.ts
```

`port.py` uses only Python's standard library. It parses the pinned files with
`ast.parse` and evaluates only literal strings, references to known string
constants, string concatenations, and f-string insertions of known strings.
It rejects any other expression rather than executing it. It never imports the
agent, calls `eval`/`exec`, or initializes upstream services. It also extracts the
literal fallback and exact focus suffix from the builder ASTs.

Upstream `/learn` applies `(user_request or "").strip()`, substitutes the
conversation-workflow fallback for an empty result, then interpolates that
request **once**, between `THE REQUEST:\n` and the remaining instructions. It
appends source hygiene, authoring standards, and knowledge-base standards in
that order. It is not a generic string-format operation on the request. Bob's
`buildLearnPrompt(request: string)` uses `trim()` and string concatenation so
braces, dollar substitutions, quotes, paths, and multiline request content stay
literal. Only leading/trailing whitespace is removed. `buildRefinePrompt`
returns the combined review byte-for-byte for absent/blank focus and otherwise
appends the upstream focus wording with the trimmed focus. Inputs are typed
strings; this port does not add Python's permissive falsey-input API.

## Native adaptations

`adaptations.json` is the complete ordered list of exact text replacements.
All other extracted text is preserved, including active-review signals,
class-level skill preference order, topical support files, deduplication,
preference embedding, source hygiene, incremental knowledge-base processing,
and the real option to save nothing. In particular:

- Memory `user` / `memory` route to Bob's native user-profile/environment
  stores, not upstream `USER.md` / `MEMORY.md` files.
- Explicit skill requests, `skills_list`, `skill_view`, and enhanced
  `skill_manage` (`create`, `patch`, `edit`, `write_file`) are the native skill
  path. The legacy `skill_save` remains compatible; this module does not remove
  or replace it. Native supporting scripts must be loaded with `skill_view`,
  materialized with `write`, then invoked through `bash`; a relative support
  path is not a backend filesystem path.
- Tool framing uses `bash`, `read`, `write`, `edit`, `web_search`, `browser`,
  `subagent`, `memory`, and the native skill tools. Search uses shell utilities
  through `bash`; URL gathering uses `browser` navigation/page text. Unsupported
  upstream tool names are not advertised. Author and metadata use Bob's name.
- The original ENFORCED fresh-read wording is retained and scoped to background
  reviews: native resource tools consult `LearningWorker` and enforce current
  exact-target reads, including explicit `/refine` workers. New skills and new
  supporting files need no prior read. The deterministic native curator handles
  lifecycle maintenance; optional consolidation is explicitly invoked with
  `learning(action="consolidate")` and is off by default. Its writable candidate
  set excludes pinned, archived, legacy and foreground-managed packages. Bob
  schedules do not have upstream cron skill-reference fields, so consolidation
  does not rewrite schedules.
  The original 60-character description guidance and index-truncation rationale
  are preserved: Bob's compact skill index also truncates descriptions at 60.
- These prompts do not themselves register tools, enforce restrictions, request
  approval, start a curator, schedule background work, alter permissions, or
  change Durable state. Native tools and the learning host implement those
  capabilities separately. The strings describe the implemented background
  read-before-write mechanism without adding an approval gate.

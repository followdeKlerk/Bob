# Working with Bob

Read this entry point, then only the section needed for the task. Do not load the whole documentation tree into model context.

## Where to look

- [README](README.md): application overview and user entry points.
- [Features](FEATURES.md): task → tool, prerequisites, scope, success criteria and limitations.
- [Operations](OPERATIONS.md): development, deployment, recovery, extensions and source map.
- `docs/`: private historical plans, evidence and backups, **not current feature authority**. Do not bulk-read, publish or package it.

Live tool schemas and current configuration take precedence over these guides. Source describes what is implemented, not proof that it is deployed or working on a particular phone. Never use old chat/memory claims as verification.

## Non-negotiable boundaries

- Use existing capabilities for the requested task. A feature-use request is not permission to extend or redeploy Bob.
- Create subagents only on an explicit user request. Existing peer conversations are independent agents, not owned children.
- Preserve official Pi Durable authority. Do not edit its database, bypass the owner lock or start another owner of the live state.
- Use `self_update` for authorized application changes. Do not restart/kill the serving backend, uninstall Android or restore old chat data to roll code back.
- Distinguish admission, completion and delivery. Reconcile uncertain side effects instead of resending them.
- Notes, memory, skills and todos have different purposes. Read [the feature guide](FEATURES.md#information-and-instructions) before choosing a persistence mechanism.
- Shell/file/browser tools run on the backend account, not the phone; module selection is not a sandbox. Keep credentials out of chats and documentation.

## Keep documentation small

Update the relevant guide with the feature change, including prerequisites, failure behavior and observable success. Prefer one maintained explanation over copied schemas or release diaries. Link to implementation/tests for deeper investigation; do not turn historical test evidence into a current guarantee.

Bob does **not** automatically scan `AGENTS.md`. Enabled backend skills are included in full through the resources module. The documentation-index skill should remain a short pointer to these files, not a copy of them.

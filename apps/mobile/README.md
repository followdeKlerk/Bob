# Bob Android app

The Android app connects to your Bob backends for conversations, files, Notes, delegated agents and settings. It also supports notifications, on-demand location, reply read-aloud and diagnostics. Android is the supported platform; there is no supported iOS release.

- [Install Bob](../../INSTALL.md) — install the app, configure a backend and pair your phone.
- [Features](../../FEATURES.md) — app navigation and everyday workflows.
- [Operations](../../OPERATIONS.md) — backend configuration, updates and recovery.

## Updates

For a managed deployment, ask Bob to update Android using `self_update` with target `android` or `all`. Once the signed APK is ready, approve installation through **Build & install**. Keep the existing app installed to preserve its local data; updates use the same signing identity.

Each backend keeps its own conversations and configuration. Drafts, cached history, queued messages and offline Notes edits remain associated with the backend where you created them.

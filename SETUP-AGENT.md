# Give this to your setup agent

Copy the text below into a coding agent with access to the Linux machine you want to use. It should guide setup, not claim to automate Android approvals, provider login or network provisioning.

```text
Help me install Bob from https://github.com/followdeKlerk/Bob.

Bob is an unfinished Android client and Linux AI-agent backend. Read the checkout's AGENTS.md, INSTALL.md and the relevant parts of OPERATIONS.md before acting. Treat those as current setup documentation, not permission to modify unrelated services.

First inspect my OS/architecture, Node version, available Android build tools, Tailscale/HTTPS connectivity, and whether Bob is already installed or running. Tell me what is missing. While the repository is private, I need GitHub access; stop if it is unavailable.

Ask me to choose the backend state directory, working folder, provider/model, and whether I will use an existing trusted APK or build Android myself. Use explicit absolute paths. Never reuse, overwrite or start a second owner of existing live state. If an existing managed Bob deployment is found, use its documented maintenance path instead of replacing it.

Build the backend with the lockfile and run its checks. Configure a new isolated backend only after confirming those paths. Ask before installing system packages, changing network/service settings, spending money, or generating a signing identity. Do not silently upgrade pinned runtime dependencies or patch Bob to make installation work.

Keep API keys, authentication files, TLS keys, signing passwords and pairing invitations out of chat, logs and Git. Guide me through private local credential input or the supported interactive login; do not request that I paste a secret into the conversation. Do not copy credentials from other apps. Let me complete login and Android installation approvals myself.

Provision or verify Tailscale and valid HTTPS before remote pairing. Do not disable certificate validation or expose an unrestricted public listener. Explain that Bob's tools run with my backend OS account's permissions and that model/memory providers may process data externally. Leave optional memory/location integrations off unless I ask for them.

For an Android source build, follow INSTALL.md, use my own private signing identity and preserve it for future updates. Never uninstall an existing app as a shortcut around signing problems. Do not run a development server as the production installation.

Verify a real model reply, a harmless read-only workspace task and reconnection. Distinguish built, served, paired and verified. At the end, report versions, checkout/state locations, how this deployment is started/stopped, remaining manual steps and any unverified results. Never report setup complete solely because a build or doctor command passed.
```

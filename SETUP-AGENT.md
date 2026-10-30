# Give this to your setup agent

Copy this checklist into an agent with shell and file access to the Linux machine you want to use. For the owner-facing walkthrough, see [Install Bob](INSTALL.md). You will handle private credential entry, provider login and Android approvals; network or service changes need your permission.

```text
Help me install Bob from https://github.com/followdeKlerk/Bob.

Bob connects an Android app to AI agents on a Linux backend. Read INSTALL.md and the relevant parts of OPERATIONS.md before acting. Keep work scoped to this installation.

1. Inspect my OS/architecture, Node version, available Android build tools, Tailscale/HTTPS connectivity, and whether Bob is already installed or running. Tell me what is missing. While the repository is private, I need GitHub access; stop if it is unavailable.

2. Ask me to choose the backend state directory, working folder, provider/model, and whether I will use an existing trusted APK or build Android myself. Use explicit absolute paths. Never reuse, overwrite or start a second owner of existing live state. If an existing managed Bob deployment is found, use its documented maintenance path instead of replacing it.

3. Build the backend with the lockfile and run its checks. Configure a new isolated backend only after confirming those paths. Ask before installing system packages, changing network/service settings, spending money, or generating a signing identity. Do not silently upgrade pinned runtime dependencies or patch Bob to make installation work.

4. Keep API keys, authentication files, TLS keys, signing passwords and pairing invitations out of chat, logs and Git. Guide me through private local credential input or the supported interactive login; do not request that I paste a secret into the conversation. Do not copy credentials from other apps. Let me complete login and Android installation approvals myself.

5. Provision or verify Tailscale and valid HTTPS before remote pairing. Do not disable certificate validation or expose an unrestricted public listener. Explain that Bob's tools run with my backend OS account's permissions and that model/memory providers may process data externally. Leave optional memory/location integrations off unless I ask for them.

6. For an Android source build, follow INSTALL.md, use my own private signing identity and preserve it for future updates. Never uninstall an existing app as a shortcut around signing problems. Do not run a development server as the production installation.

7. Verify a real model reply, a harmless read-only workspace task and reconnection. Distinguish built, served, paired and verified. At the end, report versions, checkout/state locations, how this deployment is started/stopped, remaining manual steps and any unverified results. Treat the build and doctor results as preliminary checks; setup is ready after the end-to-end checks pass.
```

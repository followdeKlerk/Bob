# Give this to your setup agent

Use this checklist with an agent that has shell and file access to the Linux machine you want to use. Read [Install Bob](INSTALL.md) for the walkthrough. You handle private credential entry, account login and Android approvals.

```text
Help me install Bob from https://github.com/followdeKlerk/Bob.
Read INSTALL.md and inspect the installer before running it.

1. Check my OS, Node, Tailscale and HTTPS setup. Find any existing Bob installation before making changes. Use install.sh --check and bob doctor for the appropriate read-only checks.
2. Confirm the backend state directory, working folder, model/account and Android APK source with me. Never overwrite existing state or start a second backend against it.
3. Prefer install.sh and bob setup --guided in my local terminal. Ask before installing packages, changing services or networking, spending money, or generating signing keys. Do not bypass approval prompts.
4. Keep credentials, private keys and pairing invitations out of chat, logs and Git. Let me enter secrets locally and complete account/Android approvals myself.
5. Use authenticated HTTPS over Tailscale. Do not disable certificate checks or expose a public unauthenticated listener. Explain that agents use my backend account's OS permissions and configured models may process data externally.
6. Use a trusted signed APK or follow INSTALL.md to build with my own signing key. Keep the same key for future updates; never uninstall an existing app to fix a signing mismatch.
7. Keep an existing supervised deployment on its own update path. New guided installs include supervised backend updates; Android builds require separately configured existing tools/signing files. Never silently replace a running standalone service: use the explicit tested updates install conversion with its exact unit hash from an independent maintenance process. Certificate renewal remains my responsibility.
8. Verify a real model reply, a harmless read-only task and phone reconnection. Report how this installation starts/stops, the chosen paths, remaining manual steps and anything not verified.
```

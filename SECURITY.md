# Reporting a security problem

Please don't post an exploit, credentials or private conversations in a public issue.

If GitHub shows **Report a vulnerability** in this repository's Security tab, use that to send a private report. If that option isn't available, open an issue asking for a private reporting channel, without including the vulnerability details. There isn't a dedicated security inbox or a guaranteed response time.

A useful report describes what happened, which version or commit you tested, and how to reproduce it with disposable data. Please only test machines and accounts you own or have permission to test.

## A few boundaries worth knowing

Bob is a personal, actively developed project. There are no maintained long-term-support branches.

The backend is intended for loopback or authenticated HTTPS over Tailscale, not an unrestricted public endpoint. Pair only devices you trust: a paired device has broad access to the backend. Agents run with the backend account's OS permissions, not inside a working-folder sandbox.

Keep pairing invitations, provider credentials, signing keys and state backups private. If you accidentally publish a credential, revoke or rotate it; deleting the post or commit alone isn't enough.

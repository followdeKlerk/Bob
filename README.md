<p align="center">
  <img src="assets/bob-logo.png" width="180" alt="Bob">
</p>

# Bob

An Android app for working with AI agents on your own Linux machines.

I built Bob because I wanted to use my agents from my phone, not just from a terminal. I use it myself, and it keeps changing as I find things I need. **This is an unfinished personal project, not a polished product.** Expect rough edges and a hands-on setup.

Bob is increasingly being tailored towards people who code: access to a working folder, files and tools, persistent conversations, and agents on connected machines. It is not an on-device model or a full mobile IDE.

## A small coding task

Ask Bob to improve a JavaScript utility, add tests and send back the updated project.

<table>
  <tr>
    <th>Ask for a change</th>
    <th>Check the tests</th>
    <th>Get the project</th>
  </tr>
  <tr>
    <td><img src="assets/showcase/coding-request.png" width="240" alt="A coding request in Bob with agent tool activity"></td>
    <td><img src="assets/showcase/coding-tests.png" width="240" alt="Bob's terminal tool result showing all five tests passing"></td>
    <td><img src="assets/showcase/coding-result.png" width="240" alt="The updated project attached as a ZIP, with a short summary"></td>
  </tr>
</table>

<p align="center">
  <img src="assets/showcase/coding-demo.gif" width="420" alt="Animated recording of Bob inspecting the sample project, editing the utility, running tests and returning a ZIP">
</p>

A real model run on a disposable sample project, captured from Bob 0.3.93 in an Android 16 emulator. The recording is trimmed, not sped up; responses are not scripted. Screenshots show different points in the same conversation.

## What it does

- Streams conversations and tool results to your phone. Backend work can continue when you leave the chat.
- Connects to multiple Linux backends, each with its own conversations and configuration.
- Gives agents file, shell and web tools, with optional memory and interactive views.
- Lets you exchange files with an agent, keep notes and return to earlier work.

The app uses React Native/TypeScript with native Android integrations. The Node.js backend runs agents through [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable).

## Try it

You need an Android phone, a Linux x86_64 machine, a supported model provider and Tailscale/HTTPS connectivity between them. There is no hosted service or one-click installer. iOS is not supported.

Follow [installation](INSTALL.md), or give your coding agent the [setup instructions](SETUP-AGENT.md). Those instructions ask it to inspect your machine, protect existing data and stop for authentication and installation approvals.

## Before connecting a machine

**Agent tools run with the backend OS account's permissions.** A working folder is not a sandbox. Use an account and machine you are comfortable giving an agent access to.

Model inference, and optional memory processing, may use external providers. Running the backend yourself does not mean inference stays local. Keep credentials and private files out of screenshots, shared conversations and commits.

## Documentation

- [Installation](INSTALL.md) — prerequisites, building, configuration and pairing.
- [Features](FEATURES.md) — current behaviour and limitations.
- [Operations](OPERATIONS.md) — development, maintenance, updates and recovery.
- [Agent working rules](AGENTS.md) — boundaries for agents working in this checkout.

No roadmap or planning archive is published here. The documentation describes what exists, not promises about future releases.

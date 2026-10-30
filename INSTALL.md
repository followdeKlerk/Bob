# Install Bob

Set up a Linux backend, connect a model provider, and pair your Android phone. This guide walks through building from source; if you want an agent to help, use the [setup-agent checklist](SETUP-AGENT.md).

## Prerequisites

- Linux x86_64, Git, and Node.js `>=24.22.1 <25` with npm. The checkout pins Node in `.mise.toml`.
- An Android device running Android 7/API 24 or newer (the build minimum). Verify operation on your device after installation.
- For Android builds: Java 17, Android SDK platform/build-tools 36 and NDK `27.1.12297006`. Gradle dependencies require network access.
- A supported OpenAI or Anthropic model and your own authentication. Model use may incur charges.
- For phone access: Tailscale on both devices, a reachable backend Tailscale address and a valid HTTPS certificate/key. Provision these before pairing.

Use a dedicated OS account if appropriate. Agents execute with that account's authority; the chosen working folder does not restrict access.

## 1. Build the backend

From a new checkout:

```sh
git clone https://github.com/followdeKlerk/Bob.git
cd Bob
npm ci
npm run build
npm test
```

Commands below run from the repository root. Use explicit absolute state and working-folder paths. Never point a second runtime at an existing live backend's state.

```sh
node dist/cli.js --state /absolute/path/to/new-bob-state setup --cwd /absolute/path/to/workspace
node dist/cli.js --state /absolute/path/to/new-bob-state doctor
```

## 2. Configure a model

Choose one supported authentication path and an exact model ID available to your account:

- API key: `node dist/cli.js --state /absolute/path/to/new-bob-state provider --provider openai --model YOUR_MODEL_ID` (or `anthropic`). The command reads the key from stdin. Supply it privately, not as an argument or in an agent conversation; use a secure local input mechanism that does not echo or log it.
- Supported ChatGPT subscription login: `node dist/cli.js --state /absolute/path/to/new-bob-state login --provider openai --model YOUR_MODEL_ID`. Complete the interactive browser flow on the backend machine. This uses loopback callback port 1455.

Use Bob's own authentication rather than another application's files. After pairing, verify the configured model with a small test conversation; `doctor` checks local configuration.

## 3. Serve and pair

Provision Tailscale reachability and the certificate/key first. Keep the key private. Replace the placeholders with your deployment's paths and addresses:

```sh
node dist/cli.js --state /absolute/path/to/new-bob-state serve \
  --host YOUR_TAILSCALE_IP --port 49158 \
  --cert /absolute/path/to/cert.crt --key /absolute/path/to/private.key
```

Leave that process running. In another terminal, from the same checkout:

```sh
node dist/cli.js --state /absolute/path/to/new-bob-state connect \
  --endpoint https://YOUR_MACHINE.YOUR_TAILNET.ts.net:49158
```

Scan the single-use invitation with Bob once the app is installed. Do not publish the invitation or pairing credentials. Loopback-only serving is useful for local checks but cannot be reached directly from a separate phone. Do not bypass TLS checks or expose the backend on an unrestricted public interface.

For persistent service operation, read [operations](OPERATIONS.md#cli-and-initial-configuration). Remote HTTPS provisioning and boot-before-login setup need configuration in addition to the service-install command.

## 4. Build and install Android

Use a trusted signed APK if one has been supplied, or build your own as follows. For your own builds, use your own signing key.

```sh
npm run build:interactive
cd apps/mobile
npm ci
../../node_modules/.bin/tsc --noEmit
```

Configure your Android SDK locally through `ANDROID_HOME` or ignored `android/local.properties`. For a signed release, set `BOB_SIGNING_PROPERTIES` to an absolute path to a private properties file containing `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. `storeFile` should be an absolute keystore path. Create and retain your own signing identity using Android's signing tools; keep the properties file and keystore outside the checkout with restricted permissions. Never commit them.

```sh
cd android
./gradlew assembleRelease
```

The APK is produced under `apps/mobile/android/app/build/outputs/apk/release/`. Transfer it to your phone and approve installation through Android. Retain the same signing identity for future in-place updates. Do not uninstall an existing installation to work around a signing mismatch; that can delete local data.

For an existing managed Bob deployment, use its configured `self_update` workflow instead of creating a parallel service or manually replacing its active backend.

## 5. Verify

- Pair the intended backend and confirm its identity in the app.
- Send a short message and confirm a real model reply.
- Try a harmless read-only task in the intended workspace.
- Reconnect and confirm the conversation remains available.
- Enable optional features such as memory, notifications or location only when wanted; they have separate prerequisites and limits in the [feature guide](FEATURES.md).

If something fails, report the failing step and a redacted error. Keep security checks enabled and preserve existing state while troubleshooting. Complete the checks above before treating the installation as ready.

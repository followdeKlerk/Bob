# Install Bob

Set up a Linux backend, connect a model account and pair your Android phone. If you want an agent to help, give it the [setup checklist](SETUP-AGENT.md).

## What you need

- An Android phone running Android 7 or later. iOS is not supported.
- A Linux x86_64 machine with a systemd user session and a compatible glibc-based distribution.
- A supported OpenAI or Anthropic model account. Model use may cost money.
- Tailscale on both devices, plus valid HTTPS for the backend.
- A trusted signed Bob APK, or the Android build tools if you want to build your own.

Agents run with your backend account's OS permissions. The working folder is not a sandbox. Prompts and relevant context go to your configured model providers and services.

## Guided installation

Download and inspect the installer, then run it as your normal user—not with `sudo`:

```sh
curl --proto '=https' --tlsv1.2 -fL \
  https://raw.githubusercontent.com/followdeKlerk/Bob/main/install.sh \
  -o bob-install.sh
less bob-install.sh
bash bob-install.sh --check
bash bob-install.sh
```

You can also use `bash install.sh` from an existing checkout. Repository and dependency downloads need network access; cloning Bob's public repository does not require GitHub authentication. Never paste access tokens into commands or chat.

The installer checks prerequisites, asks before installing missing tools, and guides you through model authentication, Tailscale, HTTPS, a supervised background/update service and phone pairing. It can install a private compatible Node runtime without replacing system Node. Package installation support covers apt, dnf and pacman; other systems may need manual setup.

Choose the state directory and working folder carefully. Existing credentials and state are preserved. A running or supervisor-managed backend is not replaced or reconfigured. Do not start a second backend against live state.

The Android app is separate: backend setup does not install it or download Android build tools. You still approve account logins, permissions and app installation yourself. Optional memory and push services need separate configuration.

To revisit guided setup or check an existing backend:

```sh
~/.local/bin/bob setup --guided
~/.local/bin/bob --state /absolute/path/to/state doctor
```

New guided installations include the supervisor used by `self_update` and **Build & install**. Backend updates work without Android tools. Building the Android app additionally requires Java, an accepted/licensed Android SDK, your existing private signing properties and a trusted reference APK. Setup can record paths to those existing files; it never generates a replacement signing identity or installs Android tools silently.

Use `systemctl --user status bob-<backend-id>.service` to inspect the service. Keep existing supervised deployments on their own update path. Setup does not automatically stop a running standalone backend just to add updates.

### Add updates to an existing standalone installation

Older guided installations ran chat without an update supervisor. A working chat connection therefore does not prove that updates are configured. `bob updates install --help` provides the supported conversion command. Run it from an independent terminal or maintenance process, **not a tool inside the backend being replaced**.

Use the existing state directory, listener/TLS or loopback-proxy arrangement and source checkout. Build and test that checkout first without discarding local changes. For example, for an existing loopback listener behind Tailscale Serve:

```sh
# Inspect the exact service and hash its unit file before approving replacement.
systemctl --user cat bob-YOUR-BACKEND-ID.service
sha256sum ~/.config/systemd/user/bob-YOUR-BACKEND-ID.service

/path/to/node /path/to/Bob/dist/cli.js --state /existing/bob-state updates install \
  --source /path/to/Bob --origin http://127.0.0.1:49158 \
  --endpoint https://YOUR-MACHINE.YOUR-TAILNET.ts.net:9443 \
  --host 127.0.0.1 --port 49158 \
  --replace-standalone --expected-unit-sha256 EXACT-UNIT-FILE-SHA256
```

For a direct HTTPS listener, preserve its address/port and add `--cert` / `--key`; use that HTTPS origin instead. Android build paths can be supplied with `--java-home`, `--android-home`, `--signing-properties` and `--reference-apk`. Do not paste file contents or passwords into arguments or chat.

Runtime packaging prefers cached npm dependencies but needs registry access when metadata or packages are missing; `npm ci` alone does not guarantee a complete offline cache. Downloads happen during preparation before the existing service is stopped, with package lifecycle scripts disabled and bounded network requests. The installer packages an isolated runtime, validates the existing compatibility floor, preserves backend identity and data, and requires exact consent before replacing a service. It refuses foreign units, unapproved drop-ins, incompatible state and absent migration evidence. Existing drop-ins are preserved byte-for-byte; approving their aggregate digest requires `--expected-dropins-sha256`. A failed startup attempts to restore the original service and installation metadata—never an older chat database. An existing supervisor is not silently converted or replaced. A service with migration-origin state may need its original retained deployment journal; do not invent migration metadata or use another backend's journal.

After conversion, verify the supervisor is online in update status. A queued job, a verified APK and an Android-approved installation remain separate milestones.

### Certificate renewal

Tailscale HTTPS certificates expire; the installer does not create a renewal timer. Renew them with Tailscale's certificate workflow and retain private-key ownership and permissions. Reload an older standalone service through its existing service procedure. For a supervised installation, use its controlled maintenance/update path; do not manually replace its running release.

Never publish keys, disable certificate checks or uninstall the Android app as a setup workaround.

## Manual backend installation

Use a new checkout, Git and Node.js `>=24.22.1 <25` with npm:

```sh
git clone https://github.com/followdeKlerk/Bob.git
cd Bob
npm ci
npm run build
node dist/cli.js --state /absolute/path/to/new-bob-state setup --cwd /absolute/path/to/workspace
node dist/cli.js --state /absolute/path/to/new-bob-state doctor
```

For development verification, follow [the contributor checks](CONTRIBUTING.md#development-checks): the full suite additionally needs mobile JavaScript dependencies and Chromium. These are not required merely to build the backend.

Configure your model using one supported authentication path and an exact model ID:

- API key: `node dist/cli.js --state /absolute/path/to/new-bob-state provider --provider openai --model YOUR_MODEL_ID` (or `anthropic`). Enter the key privately through stdin, never command arguments or chat.
- ChatGPT subscription: `node dist/cli.js --state /absolute/path/to/new-bob-state login --provider openai --model YOUR_MODEL_ID`. Complete Bob's browser login on that machine.

Provision Tailscale and valid certificate/key files, then install the supervised backend/update service:

```sh
node dist/cli.js --state /absolute/path/to/new-bob-state updates install \
  --source "$PWD" --origin https://YOUR-MACHINE.YOUR-TAILNET.ts.net:49158 \
  --host YOUR_TAILSCALE_IP --port 49158 \
  --cert /absolute/path/to/cert.crt --key /absolute/path/to/private.key
```

The user service now keeps the supervised backend running. From the same checkout, pair your phone:

```sh
node dist/cli.js --state /absolute/path/to/new-bob-state connect \
  --endpoint https://YOUR_MACHINE.YOUR_TAILNET.ts.net:49158
```

Scan the single-use invitation with Bob after installing the app. Keep the invitation private. Loopback-only serving cannot be reached directly from another phone; do not bypass TLS or expose an unrestricted public listener. For a persistent service, prefer the guided setup.

### Optional read-only email

Email access requires a separately installed, compatible Himalaya executable and a privately configured `gmx` account for the backend OS user. By default Bob uses `~/.local/bin/himalaya` under that user's home directory. To use another installation, set `BOB_HIMALAYA_PATH=/absolute/path/to/himalaya` in the trusted backend host/service environment. An explicitly empty value, relative path or path containing control characters is rejected; Bob never searches `PATH` or invokes a shell to find or run Himalaya. Tool arguments cannot override the executable.

Keep mail credentials out of chat and Git. Configuring Himalaya does not authorize email access: request it explicitly, and opt scheduled checks in with `emailAccess:true` and the intended mailbox scope. Access remains read-only, with bounded searches and no sending, drafts, flag changes, moves, deletions, attachments or link opening.

## Android installation

Use a trusted signed APK if available. To build your own, install Java 17, Android SDK platform/build-tools 36 and NDK `27.1.12297006`. Gradle dependencies need network access.

From the repository root:

```sh
npm run build:interactive
cd apps/mobile
npm ci
../../node_modules/.bin/tsc --noEmit
```

Set `ANDROID_HOME` or use ignored `android/local.properties` for the SDK path. Set `BOB_SIGNING_PROPERTIES` to a private properties file with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. Use absolute paths, keep the file and keystore outside Git with restricted permissions, and retain the signing key for future updates.

```sh
cd android
./gradlew assembleRelease
```

The APK is under `apps/mobile/android/app/build/outputs/apk/release/`. Transfer it to your phone and approve installation. Keep an existing app installed: uninstalling can delete local data, and updates must use its original signing identity.

### Optional push notifications

Without Firebase configuration, Bob uses background polling for attention alerts. For push, register Android package `com.bobmobile` in Firebase and place its `google-services.json` outside Git at `~/.local/share/bob/firebase/google-services.json`, or set `BOB_FIREBASE_CONFIG` to its path before building.

The backend needs a private `firebase-push.json` in its state directory with `projectId` and `serviceAccountFile`. The latter points to a private service-account JSON with the `roles/firebasecloudmessaging.admin` role. Enable Firebase Cloud Messaging and use the same project for both sides. Keep service-account credentials out of the APK, chat and Git, readable only by the backend account. The phone needs Google Play services and notification permission.

## Verify the setup

1. Pair the intended backend and confirm its identity in the app.
2. Send a short message and confirm a real model reply.
3. Try a harmless read-only task in the intended working folder.
4. Reconnect and check that the conversation remains available.
5. Enable optional memory, notifications or phone permissions only when wanted.

A successful build, a pairing QR code or a local diagnostic alone does not establish that all these steps work. If something fails, report the step and a redacted error; keep security checks enabled and preserve existing state. See [Using Bob](FEATURES.md) for everyday features.

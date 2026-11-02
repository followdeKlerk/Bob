# Install Bob

Set up a Linux backend, connect a model provider, and pair your Android phone. Use the guided installer below or the manual steps that follow. If you want an agent to help, use the [setup-agent checklist](SETUP-AGENT.md).

## Guided installation

Download [install.sh](install.sh), inspect it, and run `bash install.sh --check` for a read-only prerequisite/path summary. Run `bash install.sh` in a local terminal as the intended **non-root** backend account to proceed. The [README](README.md#guided-backend-installation) gives the download commands. Never run a second backend against live state.

Supported first version: Linux x86_64, a working systemd **user** session, Bash and standard Linux utilities. The official Node binary also needs a compatible glibc-based distribution. Missing bootstrap tools can be installed with apt, dnf or pacman after an explicit displayed plan and sudo approval; other distributions get manual instructions. The initial download needs curl or a browser. Access to the source repository and dependency registries is required.

### What it does

1. Detects compatible Node (`>=24.22.1 <25`), bootstrap tools, the selected source checkout and the user-local launcher. If needed, offers Node `24.22.1` under `${XDG_DATA_HOME:-$HOME/.local/share}/bob-bootstrap/`, verifying its archive against the SHA256 manifest fetched from nodejs.org over HTTPS. This is checksum/HTTPS verification, not independent release-signature verification. Global Node is untouched.
2. Reuses an identified Bob checkout or asks to clone the official repository into a new user-local directory. With no compiled CLI, asks before `npm ci` and `npm run build`; these run repository/dependency scripts with the account's authority. Existing `dist/cli.js` is reused rather than rebuilding a potentially live installation. The bootstrap is an installer, not an updater.
3. Offers `~/.local/bin/bob`, pinned to the selected Node and CLI paths. It never overwrites an unrelated/different launcher or edits shell profiles. Existing compiled CLIs must support `setup --guided`; use a fresh checkout and the existing installation's upgrade procedure for older versions.
4. Enters `bob setup --guided`. Choose the state directory and existing working folder. Missing provider configuration is completed through hidden local API-key entry or Bob's supported ChatGPT browser login. Existing credentials are reused, not imported from other applications or replaced. An exact model ID is required. Optional Chromium installation is offered during configuration; it is not required for chat.
5. Detects Tailscale, offers its official Linux installer if absent, and asks before `sudo tailscale up`. Downloaded Tailscale installer code is staged locally for review and needs a second execution approval; it may configure its package repository. Login, tailnet permissions, MagicDNS and HTTPS enablement may require manual account-admin action. Existing routing options are not reset.
6. Selects the Tailscale IPv4 listener, HTTPS port and certificate/key paths. Existing matching private TLS material is reused. For the suggested new private paths, it can invoke `sudo tailscale cert` and return ownership to the backend account. This can disclose the machine's DNS name through public Certificate Transparency logs. Custom TLS paths must already contain a matching pair; partial pairs and invalid/expired certificates stop setup rather than being overwritten.
7. Offers a backend-specific systemd user service with exact absolute Node/CLI/state/TLS paths and a private umask. A differing existing service is not overwritten. Starting/enabling the service and optional boot-before-login/user lingering require approval.
8. Checks the intended backend identity over certificate-verified HTTPS, then asks whether to show the existing single-use, expiring pairing QR code. Keep the QR private. A displayed invitation is **not** proof of phone pairing, network reachability from the phone or successful model inference.

No real provider inference is run by the wizard, no Android tools/APK are installed, and no optional memory/FCM integration is enabled. Follow the Android and verification steps below. This creates a standalone service, not the optional maintenance/self-update supervisor.

### Reruns and existing backends

```sh
~/.local/bin/bob setup --guided
~/.local/bin/bob --state /absolute/path/to/state doctor
```

Completed configuration is kept when a later step is declined or fails. Reruns inspect it and do not blindly reinstall components. A running or supervisor-managed state is limited to endpoint verification and optional pairing; the wizard never stops it, changes its credentials or installs a competing service. Invalid schemas, ambiguous state directories, unknown locks and conflicting services require manual diagnosis. No chat databases are reset. The read-only `doctor` command remains separate; the original scripted `setup --cwd` interface is unchanged.

`setup-connection.json` in the selected state directory records only listener/port and TLS file paths. Private keys stay in the chosen files. For a standalone service, inspect it with `systemctl --user status bob-<backend-id>.service`; use its matching explicit start/stop commands as needed. Existing managed deployments must continue using their supervised update path.

### Certificate renewal

**This installer does not create a certificate-renewal timer.** Tailscale HTTPS certificates expire. Arrange renewal before expiry using Tailscale's documented certificate workflow. For the suggested files, run `tailscale cert` with appropriate privileges, restore owner-only key permissions and ownership to the backend account, then explicitly restart the **standalone** service to reload the files. Do not use these instructions to manually restart a supervisor-managed backend. Never publish keys, copy them into Git, disable TLS verification or uninstall the Android app to repair setup.

## Manual installation prerequisites

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

For persistent service operation, use the guided setup above or read [operations](OPERATIONS.md#cli-and-initial-configuration). The legacy `service-install` command remains loopback-oriented; remote HTTPS provisioning and boot-before-login setup need separate configuration when using that manual command.

## 4. Build and install Android

Use a trusted signed APK if one has been supplied, or build your own as follows. For your own builds, use your own signing key.

```sh
npm run build:interactive
cd apps/mobile
npm ci
../../node_modules/.bin/tsc --noEmit
```

Optional FCM push setup is described in [operations](OPERATIONS.md#firebase-push-delivery). Supply the external Firebase Android configuration before building if you want push; without it, Bob retains polling-only notifications.

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

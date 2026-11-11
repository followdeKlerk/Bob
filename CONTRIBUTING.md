# Contributing to Bob

Bug reports and focused pull requests are welcome. For a substantial feature or restructuring, open an issue first. Bob is a personal project with no guaranteed review or release schedule. Be respectful and keep discussions about the work.

For setup and everyday use, start with [installation](INSTALL.md) and [features](FEATURES.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), not public bug reports.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | Linux backend, CLI, authentication, lifecycle and native tool integration |
| `packages/` | Shared agent extensions: core, coding, resources, subagents, web, interactive views, peers and memory |
| `apps/mobile/` | React Native Android app and native Android services |
| `apps/interactive/` | Isolated browser host bundled into the Android app |
| `test/` | Backend regression tests and synthetic fixtures |
| `apps/mobile/__tests__/` | App component and behavior tests |
| `assets/` | Branding and licensed upstream learning-prompt provenance |
| `tools/` | Development utilities, including opt-in model evaluation |
| `.github/` | Contribution templates and automated checks |

The iOS scaffold under `apps/mobile/ios/` is not a supported product. Root guides describe supported workflows; package-level READMEs explain their own components. The ignored local `docs/` directory is not required to build or contribute.

## Development checks

Use Linux and the Node version in [.mise.toml](.mise.toml). Work in a separate checkout and use disposable state outside the repository—never attach a test backend to an existing installation's live state.

From the repository root:

```sh
npm ci
npm ci --prefix apps/mobile
npm test
node tools/check-package.mjs
```

`npm test` rebuilds the backend and workspaces before running the complete test suite. CLI integration tests launch the built production entry point (`dist/cli.js`); run `npm run build` first when invoking those test files directly.

The root suite includes cross-component tests that import mobile JavaScript dependencies, so both dependency installs above are required; no Android SDK is needed for these checks.

Browser tests require Chromium. They use `BOB_TEST_CHROMIUM` when explicitly set, otherwise the system `/usr/bin/chromium` when available, then Playwright's bundled browser. On a clean Linux machine, `npx playwright install --with-deps chromium` installs the browser and required system libraries (system installation may request sudo). The test runner supplies the OS temporary-directory default when `TMPDIR` is unset. These are test settings, not changes to the production browser configuration.

The checked-in GitHub Actions workflow runs the backend build and test suite (including documentation, repository hygiene and prompt tests), learning-prompt provenance verification, package inventory/link checks, and mobile tests/typecheck without provider credentials. Environment-gated tests may skip; report skips rather than treating them as passes. CI does not build signed Android releases or verify on-device behavior. Run the relevant checks locally and report their results.

For documentation-only changes, run the local link and structure checks:

```sh
node --import tsx --test test/documentation.test.ts
```

For mobile changes, install the app's separate dependencies and run its checks:

```sh
npm run build
npm run build:interactive
cd apps/mobile
npm ci
npm test -- --runInBand
../../node_modules/.bin/tsc --noEmit
```

Native Android build prerequisites and private release signing are covered in [INSTALL.md](INSTALL.md#android-installation). A JavaScript test pass is not proof that an APK builds or a feature works on a phone. Do not commit compiled bundles just because a build regenerated them unless the change requires updating that tracked asset.

Tests should use synthetic data and mocked services. Do not run `tools/learning-reuse-eval.ts --run` as a routine test: it uses real model credentials and can incur charges. Its live evaluation is explicitly opt-in, separate from `npm test`.

## What belongs in a pull request

- Explain the problem, the change and how you tested it. State what you did not test.
- Keep unrelated refactors and generated churn out. Add regression coverage for changed behavior.
- Update the relevant public guide when supported behavior or installation changes.
- Preserve upstream licenses, attribution and reproducible fixture provenance. Bundled generic prompts and security tests are intentional public source, not private installation data.
- For changes to persisted state or the update lifecycle, explain compatibility, migration and rollback. Never solve a code rollback by restoring an older conversation database.

## Publishing a release

A local self-update APK is not automatically a public release. Publish only after reviewing the exact source and testing the signed artifact:

1. Start from a reviewed, committed source revision. Do not publish a dirty working tree or tag unrelated changes as a release.
2. Run the backend build and tests, mobile tests/typecheck, prompt provenance check and package inspection. Record any platform limitations honestly. Review the source and artifacts for private data.
3. Build Android using the private signing setup in [INSTALL.md](INSTALL.md#android-installation). Preserve the existing release signing identity and increase the Android version code for updates. Do not bundle an owner's optional Firebase configuration into a public build without deliberately selecting the public release configuration.
4. Verify the APK with the Android SDK's `apksigner verify --verbose --print-certs PATH_TO_APK`. Record the public signer certificate SHA-256 fingerprint and compute the APK checksum with `sha256sum PATH_TO_APK`. These public digests are not signing keys.
5. Test installation, pairing, a real model reply, reconnection and an upgrade from the previous supported APK on a disposable test installation. Never uninstall an owner's app to make an update work.
6. Create a versioned Git tag for that exact revision and a [GitHub Release](https://github.com/followdeKlerk/Bob/releases). Attach the verified APK and a checksum file; describe the source commit, app version/code, signer fingerprint, changes, known limitations and any state-compatibility requirements. Keep keys, state, local logs and credentials out of release assets.
7. Download the published asset and compare its checksum and signer with the verified local artifact. Confirm that README installation links still point to the canonical release/build route.

Repository maintainers should enable **Settings → Security → Advanced Security → Private vulnerability reporting** (GitHub may label this section **Code security**), then verify the private reporting link in [SECURITY.md](SECURITY.md). Enabling the feature is a GitHub account-side setting, not a source-code change. GitHub Actions must also be enabled before checked-in workflows can run.

## Public-source boundary

Publish code, generic prompts, synthetic fixtures, build instructions and necessary third-party notices. Do not publish personal memory or skills, chat exports, state databases, logs, pairing QR codes, credentials, signing material, private hostnames or local planning/acceptance diaries. Use example hostnames and paths in tests and documentation.

Review screenshots and recordings for private content before attaching them. Label mockups or staged examples; don't present them as evidence of a working feature. Keep generated APKs and archives out of Git; release artifacts belong in a deliberate release process, with their origin and signing identity explained.

Before submitting, inspect `git status --short` and `git diff --check`, then review the actual diff. `.gitignore` prevents some accidental additions; it does not remove tracked files, scrub Git history or replace a secret review. If a secret was published, revoke or rotate it and use the private security-reporting route.

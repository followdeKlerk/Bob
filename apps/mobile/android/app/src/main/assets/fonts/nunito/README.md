# Nunito — rounded app UI and chat prose

Bob bundles **Nunito 3.602**, Copyright 2014 The Nunito Project Authors
([upstream](https://github.com/googlefonts/nunito)), under the
[SIL Open Font License 1.1](OFL.txt). Owner reference:
[Google Fonts specimen](https://fonts.google.com/specimen/Nunito).

## Official, unmodified bytes

The eight full-script static TTFs were downloaded directly from Google Fonts’
`fonts.gstatic.com/s/nunito/v32/` URLs. The exact CSS request/response, each
immutable download URL, each SHA-256 digest, and the pinned Google Fonts
revision supplying the license are recorded in [provenance.json](provenance.json)
and [google-fonts.css](google-fonts.css). These are official static instances,
not fonts instantiated, subsetted, renamed internally, or otherwise modified
by Bob. Only filesystem names were adapted to Android resource identifiers.
The OFL is copied verbatim; no Reserved Font Name exception is needed.

The extended-script request includes Latin, extended Latin, Cyrillic and
Vietnamese; tests check representative glyphs as well as the font tables’
actual weights and italic flags. Other scripts use Android/browser fallback.

## Integration and scope

- `res/font/nunito.xml` maps real 400/500/600/700 normal and italic faces.
  Static fonts also work on Android 24–25 without variable-font support.
- `MainApplication` registers the family as `Nunito` before React Native loads;
  `AppTheme` makes it the default for app-owned native UI and dialogs.
- `typography.ts` makes normal/UI text and inputs Nunito. Explicit `mono`
  typography keeps code, raw tool payloads and inline/fenced Markdown aligned
  in Nordwand Mono. Caller size, weight, italic, accessibility, scaling and
  native ref behavior are retained. Android 24–27’s React Native weight
  selection may coalesce intermediate weights to regular/bold, as before;
  Android 28+ selects the real intermediate faces. Other weights use the
  platform’s nearest-face/synthesis behavior.
- Interactive host chrome embeds these same TTF resources as data URLs; no
  duplicate font binaries and no runtime network fetch. MCP apps receive
  separate optional sans/mono preferences. Authored visual/MCP HTML is not
  forcibly restyled. Original files, PDF pixels, terminal font metrics and
  all existing Nordwand assets are unchanged.

Run `node --import tsx --test test/typography.test.ts` from the repository root
to verify licenses, hashes, static weight/italic metadata and script coverage.
Native APK/device checks are still required to verify Android rendering.

# Licensed control assets

`button.tsx`, `text.tsx`, and `tabs.tsx` come from **React Native Reusables**,
MIT © Founded Labs, pinned to commit
`385834c2196f8a303cbc9057d1ac768f3bde0a3b`:

https://github.com/founded-labs/react-native-reusables/tree/385834c2196f8a303cbc9057d1ac768f3bde0a3b/packages/registry/src/nativewind/components/ui

The upstream license is retained in `LICENSE`. Imports are local; Text uses
Bob's bundled font wrapper. The shared `SectionSegments` adapter uses the Tabs
asset and `@rn-primitives/tabs` 1.5.2 for native selection/accessibility behavior.
It adapts the palette and replaces upstream fixed heights with growing rows,
48dp targets and scalable labels. It adds no selection checkmark or motion.
Header `RoundAction` uses the existing Button asset's ghost/default variants.

React DOM is pinned to the same version as React to satisfy the tab package's
web-only Radix peer dependency without upgrading the Android app's React.
The native tab implementation does not import Radix or React DOM. Tests load
the real primitives (their published JS contains JSX) rather than substituting
successful mocks. Native rendering and TalkBack still need device verification.

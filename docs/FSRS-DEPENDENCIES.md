# FSRS dependencies

- TypeScript: `ts-fsrs` **5.4.2**, exact npm version and integrity in `package-lock.json`, MIT license.
- Swift: `open-spaced-repetition/swift-fsrs` commit **4fbaf20** (downloaded 2026-10-08), MIT license retained at the start of `ios/VibeWord/Core/FSRSVendor.swift`.
- Swift sources from `Sources/FSRS/**/*.swift` are concatenated in sorted path order into `FSRSVendor.swift`. Each source boundary is labelled. The only symbol adaptation is `Card` → `VendorFSRSCard`, avoiding collision with the app's existing Card. No algorithm formulas are changed. Vendoring keeps the existing direct `swiftc` Mac bridge and offline Watch/Xcode builds dependency-free.
- Both adapters explicitly supply the same FSRS-6 21-parameter vector; neither relies on the upstream default algorithm version.
- Anki scheduling policy reference: [26.09.3 review states](https://github.com/ankitects/anki/blob/26.09.3/rslib/src/scheduler/states/review.rs) and [learning steps](https://github.com/ankitects/anki/blob/26.09.3/rslib/src/scheduler/states/steps.rs). The wrapper implements the documented behavior; it does not copy Anki source.

Updating a dependency requires regenerating and passing `scripts/test-fsrs.mjs` and Swift `FSRSTests`, including optimizer parity. Package version and FSRS algorithm version are separate identifiers.

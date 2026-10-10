# Interface languages

macOS (React/Tauri), iOS, and Apple Watch support English and Simplified Chinese.
The default is **Follow system**. The first supported language in the system's
preferred-language list is used; unsupported lists fall back to English.
Chinese variants currently use Simplified Chinese.

Change **Settings → Language** on Mac/iPhone. On Watch, open the gear button on
the home screen, then **Language**. Changes apply immediately and survive restart.
Each device has its own preference; it is not included in card/folder sync.
Watch widgets share the Watch preference via the existing App Group.
Existing card contents and AI generation prompts are unchanged.

## Maintaining translations

- `src/locales/en.json` is the shared catalog, keyed by the Chinese source text.
- React uses `t(key, ...arguments)` and translates stable status/error values at
  display time with `localizedMessage`. Preference persistence is in `storage.ts`.
- Native views use `L(key, ...arguments)`, plus an observed preference read to
  refresh existing screens without resetting their view state.
- Use complete messages with numbered placeholders (`{0}`, `{1}`), not fragments.
- Never translate user card contents or use localized labels as task-state IDs.
- After editing the catalog, run `python3 scripts/generate-localizations.py` to
  update `ios/VibeWord/Core/EnglishMessages.swift`.

## Checks

```sh
node scripts/test-localization.mjs
npm run build
npm run test:mobile
swift test --package-path ios
bash src-tauri/macos/test.sh
```

The iOS and Watch UI test targets each include
`testInterfaceLanguageSwitchAndPersistence`, covering live switching, restart,
and returning to Follow system.

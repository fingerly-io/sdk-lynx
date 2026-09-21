# @fingerly/lynx

The Fingerly SDK for Lynx. It is a thin Native Module over the Fingerly iOS and
Android SDKs; all collection, transport and scoring stays native.

Lynx 4.1 and iOS/Android are supported in this first release. HarmonyOS, Web,
Lynxtron and per-`LynxView` registration are not supported.

## Install

```sh
pnpm add @fingerly/lynx
```

The host app must enable [Lynx Native Library Autolink](https://lynxjs.org/guide/autolink):

- Android: apply `org.lynxsdk.library-settings` in `settings.gradle` and
  `org.lynxsdk.library-build` in the app module, then sync and rebuild.
- iOS: install `cocoapods-lynx-library`, add
  `plugin 'cocoapods-lynx-library'` and `use_lynx_library!` to the Podfile, run
  `pod install`, then rebuild.

The package's `lynx.lib.json` registers the `Fingerly` Native Module. Native
Modules are available from Lynx background-thread scripting, so call the SDK
from an event handler, effect, or other background function.

## Identify

```ts
import { load } from '@fingerly/lynx'

const fingerly = await load({ apiKey: 'fly_pk_production_…' })
const result = await fingerly.identify({ tag: 'checkout' })

if (result.verdicts.jailbreak.value) {
  // Send result.requestId to your backend and make the decision there.
}
```

`load` reports `lynx-ios` or `lynx-android`, allowing the server to select the
correct native risk profile. `identify()` defaults to submission; pass
`{ submit: false }` to collect and score locally. `collect()` returns the native
signal report without submitting it.

```ts
const report = await fingerly.collect()
const version = nativeVersion()
```

Failures are surfaced as `FingerlyError`. `status` is populated only for a
positive HTTP status returned by the native transport.

## Consent

If your legal basis for identifying users is consent (ePrivacy, GDPR), load the
SDK with `consent: 'pending'` and pass on the answer from your consent tool when
it arrives:

```ts
import { ConsentError, load } from '@fingerly/lynx'

const fingerly = await load({ apiKey: 'fly_pk_production_…', consent: 'pending' })

// From your consent tool's callback:
fingerly.setConsent(accepted ? 'granted' : 'denied')

fingerly.consent // 'granted', 'pending' or 'denied'
```

| Option / method | What it does |
| --- | --- |
| `consent` option on `load` | The starting state: `'granted'` (the default), `'pending'` or `'denied'`. |
| `setConsent(state)` | Records the decision. Synchronous and safe to call repeatedly. |
| `consent` | The state last given to the native SDK, read-only. |

The default is `'granted'`, so an integration that never mentions consent
behaves exactly as before. Anything other than the three states throws a
`TypeError`.

Until consent is `'granted'`, the native SDK runs no source, touches no storage
for fingerprinting and sends nothing. `identify()` and `collect()` reject with
`ConsentError`, a subclass of `FingerlyError` with `code: 'consent_required'`
and the refusing `state`:

```ts
try {
  await fingerly.identify()
} catch (error) {
  if (error instanceof ConsentError) {
    // error.state is 'pending' or 'denied'; nothing was collected or sent
  }
}
```

Withdrawing consent also stops a call already in flight before its next source
starts and before it submits, and that call rejects with `ConsentError`.
Loading collects and sends nothing, whatever the state. The native SDK holds one
state for the whole app, and each `load` sets it to the `consent` passed (or
`'granted'`), so pass `consent` on every `load`.

## Why there is no JavaScript fallback

JavaScript cannot inspect the filesystem, loaded images, debugger flags,
DeviceCheck, Android packages, or the native TLS connection. Falling back to a
partial report could mark a compromised device as clean, so a missing Native
Module is an actionable integration error.

## Native SDK development dependencies

The native SDKs are not published yet. For Android, publish the sibling
[Android SDK](https://github.com/fingerly-io/sdk-android) to Maven Local:

```sh
./gradlew :fingerly:publishToMavenLocal
```

For iOS development, point the host Podfile at the sibling
[iOS SDK](https://github.com/fingerly-io/sdk-ios) checkout before resolving
`fingerly-lynx`.

## Development

Clone recursively so `@fingerly/types` is available:

```sh
git clone --recurse-submodules git@github.com:fingerly-io/sdk-lynx.git
pnpm install
pnpm codegen
pnpm test
pnpm lint
pnpm build
pnpm example:build
ANDROID_HOME=/path/to/android-sdk ./android/gradlew -p android assembleDebug
```

Generated bridge specifications are committed. After changing
`types/platform-native-module.d.ts`, run codegen and commit the generated
TypeScript, Java and Objective-C files together.

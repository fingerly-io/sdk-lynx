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

const fingerly = await load({ apiKey: 'pk_live_…' })
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
